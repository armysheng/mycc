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
  buildBootstrapContextFiles,
  buildProjectContextPrompt,
  injectProjectContextPrompt,
  type WorkspaceBootstrapFile,
} from '../chat/openclaw-context.js';

// 发送消息请求验证
const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  images: z.array(z.object({
    data: z.string(),
    mediaType: z.string(),
  })).optional(),
});

type HistoryMessageType = 'user' | 'assistant' | 'system' | 'result';
type HistoryMessage = {
  type: HistoryMessageType;
  timestamp: string;
  [key: string]: unknown;
};

const REQUIRED_BOOTSTRAP_FILE_NAMES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
] as const;

const OPTIONAL_BOOTSTRAP_FILE_NAMES = ['MEMORY.md', 'memory.md'] as const;
const OPENCLAW_ABOUT_ME_DIR = '0-System/about-me';
const CONTEXT_PROMPT_CACHE_TTL_MS = 10 * 60 * 1000;
const SESSION_INJECTION_MARK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONTEXT_PROMPT_CACHE_ENTRIES = 512;
const MAX_SESSION_INJECTION_MARKS = 5000;

type CachedContextPrompt = {
  prompt: string;
  expiresAt: number;
};

const contextPromptCache = new Map<string, CachedContextPrompt>();
const sessionInjectionMarks = new Map<string, number>();

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

async function loadWorkspaceBootstrapFilesFromRemote(params: {
  linuxUser: string;
  workspaceDir: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();
  try {
    const bootstrapRoot = `${params.workspaceDir}/${OPENCLAW_ABOUT_ME_DIR}`;
    const entries = [
      ...REQUIRED_BOOTSTRAP_FILE_NAMES.map((name) => ({
        name,
        path: `${bootstrapRoot}/${name}`,
        required: true,
      })),
      ...OPTIONAL_BOOTSTRAP_FILE_NAMES.map((name) => ({
        name,
        path: `${bootstrapRoot}/${name}`,
        required: false,
      })),
    ];

    const script = [
      'const fs=require("fs");',
      `const entries=${JSON.stringify(entries)};`,
      'const out=[];',
      'for(const e of entries){',
      '  try{',
      '    if(fs.existsSync(e.path)){',
      '      const content=fs.readFileSync(e.path,"utf8");',
      '      out.push({name:e.name,path:e.path,content,missing:false});',
      '    }else if(e.required){',
      '      out.push({name:e.name,path:e.path,missing:true});',
      '    }',
      '  }catch(_err){',
      '    if(e.required){ out.push({name:e.name,path:e.path,missing:true}); }',
      '  }',
      '}',
      'process.stdout.write(JSON.stringify(out));',
    ].join('');

    const cmd = `sudo -n -u ${escapeShellArg(params.linuxUser)} node -e '${script}'`;
    const result = await sshPool.exec(connection, cmd);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || '读取 bootstrap 文件失败');
    }

    const parsed = JSON.parse(result.stdout) as WorkspaceBootstrapFile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.path === 'string' && typeof item.name === 'string');
  } finally {
    sshPool.release(connection);
  }
}

function nowMs(): number {
  return Date.now();
}

function deleteOldestEntries<T>(map: Map<string, T>, count: number): void {
  if (count <= 0) return;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed += 1;
    if (removed >= count) break;
  }
}

function pruneExpiredContextPromptCache(currentTime: number): void {
  for (const [key, value] of contextPromptCache.entries()) {
    if (value.expiresAt <= currentTime) {
      contextPromptCache.delete(key);
    }
  }
}

function pruneExpiredSessionInjectionMarks(currentTime: number): void {
  for (const [key, expiresAt] of sessionInjectionMarks.entries()) {
    if (expiresAt <= currentTime) {
      sessionInjectionMarks.delete(key);
    }
  }
}

function getContextPromptCacheKey(userId: number, workspaceDir: string): string {
  return `${userId}:${workspaceDir}`;
}

function getSessionInjectionKey(userId: number, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

function hasInjectedProjectContextForSession(userId: number, sessionId?: string): boolean {
  if (!sessionId) return false;
  const key = getSessionInjectionKey(userId, sessionId);
  const expiresAt = sessionInjectionMarks.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs()) {
    sessionInjectionMarks.delete(key);
    return false;
  }
  return true;
}

function markProjectContextInjectedForSession(userId: number, sessionId: string): void {
  const currentTime = nowMs();
  pruneExpiredSessionInjectionMarks(currentTime);
  const key = getSessionInjectionKey(userId, sessionId);
  sessionInjectionMarks.set(key, currentTime + SESSION_INJECTION_MARK_TTL_MS);
  if (sessionInjectionMarks.size > MAX_SESSION_INJECTION_MARKS) {
    deleteOldestEntries(
      sessionInjectionMarks,
      Math.max(1, sessionInjectionMarks.size - MAX_SESSION_INJECTION_MARKS),
    );
  }
}

async function getProjectContextPromptCached(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
}): Promise<string> {
  const currentTime = nowMs();
  pruneExpiredContextPromptCache(currentTime);
  const cacheKey = getContextPromptCacheKey(params.userId, params.workspaceDir);
  const cached = contextPromptCache.get(cacheKey);
  if (cached && cached.expiresAt > currentTime) {
    return cached.prompt;
  }

  const bootstrapFiles = await loadWorkspaceBootstrapFilesFromRemote({
    linuxUser: params.linuxUser,
    workspaceDir: params.workspaceDir,
  });
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles);
  const prompt = buildProjectContextPrompt(contextFiles);
  contextPromptCache.set(cacheKey, {
    prompt,
    expiresAt: currentTime + CONTEXT_PROMPT_CACHE_TTL_MS,
  });
  if (contextPromptCache.size > MAX_CONTEXT_PROMPT_CACHE_ENTRIES) {
    deleteOldestEntries(
      contextPromptCache,
      Math.max(1, contextPromptCache.size - MAX_CONTEXT_PROMPT_CACHE_ENTRIES),
    );
  }
  return prompt;
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

      if (body.sessionId) {
        const ownsSession = await userOwnsConversation(userId, body.sessionId);
        if (!ownsSession) {
          return reply.status(403).send({
            success: false,
            error: '无权访问该会话',
          });
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
      let enhancedMessage = body.message;
      let didInjectProjectContext = false;
      try {
        const shouldInjectProjectContext = !hasInjectedProjectContextForSession(userId, body.sessionId);
        if (shouldInjectProjectContext) {
          const projectContextPrompt = await getProjectContextPromptCached({
            userId,
            linuxUser,
            workspaceDir: cwd,
          });
          const mergedMessage = injectProjectContextPrompt(body.message, projectContextPrompt);
          didInjectProjectContext = mergedMessage !== body.message;
          enhancedMessage = mergedMessage;
        }
      } catch (bootstrapErr) {
        console.warn(`[Chat] workspace context injection skipped userId=${userId}:`, bootstrapErr);
      }

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

      let currentSessionId = body.sessionId;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let model = process.env.VPS_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

      try {
        console.log(`[Chat] 用户 ${userId} 发送消息: ${body.message.substring(0, 50)}...`);

        // 流式处理响应
        for await (const event of adapter.chat({
          message: enhancedMessage,
          sessionId: body.sessionId,
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
          const derivedTitle = body.sessionId ? undefined : extractConversationTitle(body.message);
          const upserted = await upsertConversation({
            userId,
            sessionId: currentSessionId,
            title: derivedTitle,
          });
          if (!upserted) {
            throw new Error('会话归属校验失败');
          }
          if (didInjectProjectContext) {
            markProjectContextInjectedForSession(userId, currentSessionId);
          }
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
