import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import path from 'path';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { concurrencyLimiter } from '../concurrency-limiter.js';
import {
  checkQuota,
  findUserById,
  logUsage,
  renameConversation,
  upsertConversation,
  updateConversationStats,
  userOwnsConversation,
} from '../db/client.js';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { extractSessionId, extractUsage, extractModel } from '../adapters/stream-parser.js';
import {
  escapeShellArg,
  sanitizeLinuxUsername,
  validateLinuxUsername,
  validatePathPrefix,
} from '../utils/validation.js';
import { getSSHPool } from '../ssh/pool.js';
import {
  bindMainSession,
  clearMainSession,
  getSoulState,
  injectSoulMemory,
  readSoulMemory,
  resolveChatSession,
  writeSoulMemory,
} from '../chat/session-soul.js';

// 发送消息请求验证
const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  images: z.array(z.object({
    data: z.string(),
    mediaType: z.string(),
  })).optional(),
});

const memoryUpdateSchema = z.object({
  content: z.string().max(8000),
});

type HistoryMessageType = 'user' | 'assistant' | 'system' | 'result';
type HistoryMessage = {
  type: HistoryMessageType;
  timestamp: string;
  [key: string]: unknown;
};

function isHistoryMessage(value: unknown): value is HistoryMessage {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.type === 'string' &&
    ['user', 'assistant', 'system', 'result'].includes(entry.type) &&
    typeof entry.timestamp === 'string'
  );
}

function extractConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  const cleaned = normalized.replace(/^\/[^\s]+/, '').trim();
  const source = cleaned || normalized;
  const maxLength = 40;
  return source.length > maxLength ? `${source.slice(0, maxLength)}...` : source;
}

export async function chatRoutes(fastify: FastifyInstance) {
  // POST /api/chat - 发送消息（SSE 流式响应）
  fastify.post('/api/chat', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const body = chatSchema.parse(request.body);
      const userId = request.user.userId;
      const linuxUser = request.user.linuxUser;
      const resolved = await resolveChatSession(userId, body.sessionId);
      let effectiveSessionId = resolved.effectiveSessionId;

      if (effectiveSessionId) {
        const ownsSession = await userOwnsConversation(userId, effectiveSessionId);
        if (!ownsSession) {
          if (body.sessionId) {
            return reply.status(403).send({
              success: false,
              error: '无权访问该会话',
            });
          }

          // main 会话文件残留（如数据库重置）时自动自愈，降级为创建新会话
          await clearMainSession(userId);
          effectiveSessionId = undefined;
        }
      }

      // 检查额度
      const quota = await checkQuota(userId);
      if (!quota.allowed) {
        return reply.status(403).send({
          success: false,
          error: '额度已用完',
          remaining: 0,
        });
      }

      // 获取并发许可
      await concurrencyLimiter.acquire(userId);

      // 验证 linuxUser 格式
      if (!validateLinuxUsername(linuxUser)) {
        return reply.status(400).send({ error: 'Invalid user format' });
      }

      // 获取用户工作目录（VPS 上统一使用 /home/{linuxUser}/workspace）
      const cwd = path.join('/home', linuxUser, 'workspace');
      const soulMemory = await readSoulMemory(userId);
      const enhancedMessage = injectSoulMemory(body.message, soulMemory);

      // 验证路径安全性
      if (!validatePathPrefix(cwd, '/home/')) {
        return reply.status(400).send({ error: 'Invalid path' });
      }

      // 创建 RemoteClaudeAdapter
      const adapter = new RemoteClaudeAdapter();

      // 设置 SSE 响应头
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      let currentSessionId = effectiveSessionId;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let model = process.env.VPS_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

      try {
        console.log(`[Chat] 用户 ${userId} 发送消息: ${body.message.substring(0, 50)}...`);

        // 流式处理响应
        for await (const event of adapter.chat({
          message: enhancedMessage,
          sessionId: effectiveSessionId,
          cwd,
          linuxUser,
          images: body.images,
        })) {
          // 提取 session_id
          const sessionId = extractSessionId(event);
          if (sessionId) {
            currentSessionId = sessionId;
          }

          // 提取 usage 信息
          const usage = extractUsage(event);
          if (usage) {
            totalInputTokens += usage.inputTokens;
            totalOutputTokens += usage.outputTokens;
          }

          // 提取 model 信息
          const modelName = extractModel(event);
          if (modelName) {
            model = modelName;
          }

          // 发送事件
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        // 确保会话元数据存在（首次消息会创建并自动提取标题，会话续聊仅刷新 updated_at）
        if (currentSessionId) {
          const derivedTitle = effectiveSessionId ? undefined : extractConversationTitle(body.message);
          const upserted = await upsertConversation({
            userId,
            sessionId: currentSessionId,
            title: derivedTitle,
          });
          if (!upserted) {
            throw new Error('会话归属校验失败');
          }

          // OpenClaw 风格主会话：首次拿到会话 ID 后绑定为 main，后续无 sessionId 请求统一归并
          await bindMainSession(userId, currentSessionId);
        }

        // 记录使用量
        if (currentSessionId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          const costUsd = calculateCost(model, totalInputTokens, totalOutputTokens);

          await logUsage({
            userId,
            sessionId: currentSessionId,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            model,
            costUsd,
          });

          // 更新会话统计
          await updateConversationStats(currentSessionId, totalInputTokens + totalOutputTokens);

          console.log(`[Chat] 用户 ${userId} 使用 ${totalInputTokens + totalOutputTokens} tokens (成本: $${costUsd.toFixed(4)})`);
        }

        // 发送完成事件
        reply.raw.write(`data: ${JSON.stringify({
          type: 'done',
          sessionId: currentSessionId,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens,
          }
        })}\n\n`);
        reply.raw.end();

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
        reply.raw.end();
        console.error(`[Chat] 错误:`, error);
      } finally {
        // 释放并发许可
        concurrencyLimiter.release(userId);
      }

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '发送消息失败',
      });
    }
  });

  // GET /api/chat/identity - 获取文件化 identity/soul 状态
  fastify.get('/api/chat/identity', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const state = await getSoulState(request.user.userId);
      return reply.send({
        success: true,
        data: {
          identityId: state.profile.identityId,
          soulId: state.profile.soulId,
          mainSessionId: state.profile.mainSessionId || null,
          dmScope: state.dmScope,
          hasMemory: state.hasMemory,
          memoryChars: state.memoryChars,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '读取 identity 失败',
      });
    }
  });

  // GET /api/chat/memory - 读取 MEMORY.md 内容
  fastify.get('/api/chat/memory', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const content = await readSoulMemory(request.user.userId);
      return reply.send({
        success: true,
        data: {
          content,
          chars: content.length,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '读取 memory 失败',
      });
    }
  });

  // PUT /api/chat/memory - 更新 MEMORY.md 内容
  fastify.put('/api/chat/memory', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const body = memoryUpdateSchema.parse(request.body);
      await writeSoulMemory(request.user.userId, body.content);
      const state = await getSoulState(request.user.userId);

      return reply.send({
        success: true,
        data: {
          chars: state.memoryChars,
          hasMemory: state.hasMemory,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '更新 memory 失败',
      });
    }
  });

  // GET /api/chat/sessions - 获取会话列表
  fastify.get('/api/chat/sessions', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { limit = '20', offset = '0' } = request.query as { limit?: string; offset?: string };

      // 验证分页参数
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);
      if (isNaN(limitNum) || isNaN(offsetNum) || limitNum < 0 || offsetNum < 0 || limitNum > 100) {
        return reply.status(400).send({ error: 'Invalid pagination parameters' });
      }

      const { getUserConversations } = await import('../db/client.js');

      const conversations = await getUserConversations(
        request.user.userId,
        limitNum,
        offsetNum
      );

      return reply.send({
        success: true,
        data: {
          conversations,
          total: conversations.length,
          hasMore: conversations.length === limitNum,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取会话列表失败',
      });
    }
  });

  // POST/PUT /api/chat/sessions/:sessionId/rename - 重命名会话
  const renameSessionHandler = async (request: any, reply: any) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { sessionId } = request.params as { sessionId: string };
      const body = (request.body || {}) as { newTitle?: string; title?: string };
      const rawTitle = body.newTitle ?? body.title;
      const newTitle = typeof rawTitle === 'string' ? rawTitle.trim() : '';

      if (newTitle.length === 0 || newTitle.length > 200) {
        return reply.status(400).send({
          success: false,
          error: 'title/newTitle 必须是 1-200 字符的字符串',
        });
      }

      const updated = await renameConversation(
        request.user.userId,
        sessionId,
        newTitle
      );

      if (!updated) {
        return reply.status(404).send({
          success: false,
          error: '会话不存在或无权限',
        });
      }

      return reply.send({
        success: true,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '重命名失败',
      });
    }
  };

  fastify.post('/api/chat/sessions/:sessionId/rename', {
    preHandler: jwtAuthMiddleware,
  }, renameSessionHandler);
  fastify.put('/api/chat/sessions/:sessionId/rename', {
    preHandler: jwtAuthMiddleware,
  }, renameSessionHandler);

  // GET /api/chat/sessions/:sessionId/messages - 获取会话历史消息
  fastify.get('/api/chat/sessions/:sessionId/messages', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { sessionId } = request.params as { sessionId: string };
      const { limit = '200' } = request.query as { limit?: string };

      const limitNum = parseInt(limit, 10);
      if (isNaN(limitNum) || limitNum <= 0 || limitNum > 1000) {
        return reply.status(400).send({
          success: false,
          error: 'limit 必须是 1-1000 的整数',
        });
      }

      const ownsSession = await userOwnsConversation(request.user.userId, sessionId);
      if (!ownsSession) {
        return reply.status(403).send({
          success: false,
          error: '无权访问该会话',
        });
      }

      const user = await findUserById(request.user.userId);
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: '用户不存在',
        });
      }

      const sshPool = getSSHPool();
      const connection = await sshPool.acquire();

      try {
        const safeLinuxUser = sanitizeLinuxUsername(user.linux_user);
        const projectUserSegment = safeLinuxUser.replace(/_/g, '-');
        const projectDir = `/home/${safeLinuxUser}/.claude/projects/-home-${projectUserSegment}-workspace`;
        const historyPath = `${projectDir}/${sessionId}.jsonl`;
        const escapedLimit = Math.max(1, limitNum);
        const escapedUser = escapeShellArg(safeLinuxUser);

        const readCmd =
          `sudo -n -u ${escapedUser} bash -lc ` +
          `${escapeShellArg(`if [ -f ${historyPath} ]; then tail -n ${escapedLimit} ${historyPath}; fi`)}`;
        const result = await sshPool.exec(connection, readCmd);

        if (result.exitCode !== 0) {
          throw new Error(result.stderr || '读取会话历史失败');
        }

        const messages: HistoryMessage[] = result.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          })
          .filter(isHistoryMessage);

        return reply.send({
          success: true,
          data: {
            sessionId,
            messages,
            total: messages.length,
          },
        });
      } finally {
        sshPool.release(connection);
      }
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取会话历史失败',
      });
    }
  });

  // POST /api/abort/:requestId - 前端兼容接口（当前远程执行暂不支持真实中断）
  fastify.post('/api/abort/:requestId', {
    preHandler: jwtAuthMiddleware,
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      type: 'aborted',
      message: 'Abort 接口已接收（当前版本为兼容实现）',
    });
  });
}

/**
 * 计算 API 成本
 * 基于 Anthropic 定价（2026-02）
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // 价格单位: USD per million tokens
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-opus-4': { input: 15, output: 75 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-haiku-4-5': { input: 0.8, output: 4 },
  };

  // 匹配模型（支持部分匹配）
  let modelPricing = pricing['claude-sonnet-4-6']; // 默认
  for (const [key, value] of Object.entries(pricing)) {
    if (model.includes(key)) {
      modelPricing = value;
      break;
    }
  }

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}
