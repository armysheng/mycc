import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById, markUserInitialized, upsertConversation } from '../db/client.js';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { extractSessionId, type SSEEvent } from '../adapters/stream-parser.js';
import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername, escapeShellArg } from '../utils/validation.js';

const initializeSchema = z.object({
  assistantName: z.preprocess(
    val => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '助手名称不能为空').max(20, '助手名称最长 20 字符')
  ),
  ownerName: z.preprocess(
    val => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '称呼不能为空').max(20, '称呼最长 20 字符')
  ),
});

type InitializeSuccessResponse = {
  success: true;
  data: {
    sessionId: string;
  };
};

export function buildBootstrapPrompt(params: { assistantName: string; ownerName: string }): string {
  const assistantName = params.assistantName.trim();
  const ownerName = params.ownerName.trim();
  return [
    '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
    '',
    '请按顺序执行：',
    '1. 阅读并遵循 0-System/about-me/BOOTSTRAP.md。',
    '2. 按以下信息个性化初始化：',
    `   - 助手名称：${assistantName}`,
    `   - 用户称呼：${ownerName}`,
    '3. 更新 0-System/about-me/IDENTITY.md、0-System/about-me/USER.md、0-System/about-me/MEMORY.md。',
    '4. 初始化完成后，把 0-System/about-me/BOOTSTRAP.md 归档到 5-Archive/bootstrap/，不要保留在原位置。',
    '',
    '输出要求：最后用简洁中文汇报“已完成初始化”，并列出你实际修改的文件路径。',
  ].join('\n');
}

export function extractBootstrapError(event: SSEEvent): string | null {
  if (event.type === 'error') {
    return typeof event.error === 'string' ? event.error : 'bootstrap 执行失败';
  }

  if (event.type === 'result' && event.is_error === true) {
    if (typeof event.result === 'string' && event.result.trim()) {
      return event.result;
    }
    if (typeof event.error === 'string' && event.error.trim()) {
      return event.error;
    }
    return 'bootstrap 执行失败';
  }

  return null;
}

export async function onboardingRoutes(fastify: FastifyInstance) {
  fastify.post('/api/onboarding/initialize', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    try {
      const body = initializeSchema.parse(request.body);
      const user = await findUserById(request.user.userId);
      if (!user) {
        return reply.status(404).send({ success: false, error: '用户不存在' });
      }

      if (user.is_initialized) {
        return reply.send({ success: true, message: '已初始化' });
      }

      const linuxUser = sanitizeLinuxUsername(user.linux_user);
      const workspaceDir = `/home/${linuxUser}/workspace`;
      const claudeMdPath = `${workspaceDir}/CLAUDE.md`;
      const templateDir = '/opt/mycc/templates/user-workspace';

      const sshPool = getSSHPool();
      const connection = await sshPool.acquire();

      try {
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const preflightCmd = [
          `sudo test -d "${workspaceDir}"`,
          `sudo test -f "${claudeMdPath}"`,
        ].join(' && ');

        let preflight = await sshPool.exec(connection, preflightCmd);
        if (preflight.exitCode !== 0) {
          // 尝试一次自愈：补齐 workspace 和模板，再次校验。
          const repairCmd = [
            // 容错注册并发创建：避免「id 检查通过时序变化导致 useradd 报已存在」中断整条命令
            `(id ${escapeShellArg(linuxUser)} >/dev/null 2>&1 || sudo useradd -m -g mycc -s /bin/bash ${escapeShellArg(linuxUser)} || true)`,
            `id ${escapeShellArg(linuxUser)} >/dev/null 2>&1`,
            `sudo mkdir -p "${workspaceDir}"`,
            `sudo test -d "${templateDir}"`,
            `sudo cp -rn "${templateDir}/." "${workspaceDir}/"`,
            `sudo cp "${templateDir}/CLAUDE.md" "${claudeMdPath}"`,
            `sudo chown -R ${escapeShellArg(linuxUser)}:mycc /home/${escapeShellArg(linuxUser)}`,
          ].join(' && ');

          const repaired = await sshPool.exec(connection, repairCmd);
          if (repaired.exitCode !== 0) {
            console.error(`❌ Onboarding 自愈失败 userId=${request.user.userId} linuxUser=${linuxUser}: ${repaired.stderr}`);
          }

          // 注册接口是异步创建 VPS 用户，这里允许短暂等待，避免刚注册就初始化的竞态失败。
          for (let i = 0; i < 8; i += 1) {
            preflight = await sshPool.exec(connection, preflightCmd);
            if (preflight.exitCode === 0) break;
            await sleep(500);
          }
          if (preflight.exitCode !== 0) {
            console.error(`❌ Onboarding 目录或模板异常 userId=${request.user.userId} linuxUser=${linuxUser} path=${claudeMdPath}`);
            return reply.status(500).send({
              success: false,
              error: '初始化目录或模板异常，请联系管理员',
            });
          }
        }

        const ensureOwnerCmd = `sudo chown -R ${escapeShellArg(linuxUser)}:mycc "${workspaceDir}"`;
        const ensureOwner = await sshPool.exec(connection, ensureOwnerCmd);
        if (ensureOwner.exitCode !== 0) {
          console.error(`❌ Onboarding 权限修复失败 userId=${request.user.userId} linuxUser=${linuxUser}: ${ensureOwner.stderr}`);
          return reply.status(500).send({
            success: false,
            error: '初始化目录权限异常，请联系管理员',
          });
        }
      } finally {
        sshPool.release(connection);
      }

      const bootstrapPrompt = buildBootstrapPrompt({
        assistantName: body.assistantName,
        ownerName: body.ownerName,
      });

      const adapter = new RemoteClaudeAdapter();
      let bootstrapSessionId: string | null = null;
      let bootstrapError: string | null = null;
      for await (const event of adapter.chat({
        message: bootstrapPrompt,
        cwd: workspaceDir,
        linuxUser,
      })) {
        const sessionId = extractSessionId(event);
        if (sessionId) {
          bootstrapSessionId = sessionId;
        }
        const eventError = extractBootstrapError(event);
        if (eventError) {
          bootstrapError = eventError;
          break;
        }
      }

      if (bootstrapError) {
        console.error(`❌ Onboarding bootstrap 失败 userId=${request.user.userId}: ${bootstrapError}`);
        return reply.status(500).send({
          success: false,
          error: '初始化执行失败，请重试',
        });
      }

      if (!bootstrapSessionId) {
        console.error(`❌ Onboarding bootstrap 未生成会话 userId=${request.user.userId}`);
        return reply.status(500).send({
          success: false,
          error: '初始化未完成，请重试',
        });
      }

      await upsertConversation({
        userId: request.user.userId,
        sessionId: bootstrapSessionId,
        title: '初始化助手',
      });
      await markUserInitialized(request.user.userId);

      return reply.send({
        success: true,
        data: {
          sessionId: bootstrapSessionId,
        },
      } satisfies InitializeSuccessResponse);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '参数错误',
          details: err.errors,
        });
      }
      console.error('❌ Onboarding 失败:', err);
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '初始化失败',
      });
    }
  });
}
