import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById } from '../db/client.js';
import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername, escapeShellArg } from '../utils/validation.js';
import { clearExpiredOnboardingBootstrapTickets, issueOnboardingBootstrapTicket } from '../onboarding/bootstrap-ticket-store.js';

const initializeSchema = z.object({
  assistantName: z.preprocess(
    (val) => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '助手名称不能为空').max(20, '助手名称最长 20 字符')
  ),
  ownerName: z.preprocess(
    (val) => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '称呼不能为空').max(20, '称呼最长 20 字符')
  ),
});

type InitializeSuccessResponse = {
  success: true;
  data: {
    bootstrapPrompt: string;
  };
};

function buildLegacyGlobalMemoryPath(linuxUser: string): string {
  const projectUserSegment = linuxUser.replace(/_/g, '-');
  return `/home/${linuxUser}/.claude/projects/-home-${projectUserSegment}-workspace/memory/MEMORY.md`;
}

export function buildBootstrapPrompt(params: {
  assistantName: string;
  ownerName: string;
  linuxUser: string;
  bootstrapToken: string;
}): string {
  const assistantName = params.assistantName.trim();
  const ownerName = params.ownerName.trim();
  const workspaceDir = `/home/${params.linuxUser}/workspace`;
  const legacyGlobalMemoryPath = buildLegacyGlobalMemoryPath(params.linuxUser);
  return [
    '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
    '',
    '关键原则（必须遵守）：',
    '- 以 `0-System/about-me/` 作为唯一身份真相源。',
    '- 如果发现任何历史文件与本次输入冲突，统一以本次输入为准并覆盖冲突值。',
    '',
    '请按顺序执行：',
    '1. 阅读并遵循 0-System/about-me/BOOTSTRAP.md。',
    '2. 按以下信息个性化初始化：',
    `   - 助手名称：${assistantName}`,
    `   - 用户称呼：${ownerName}`,
    `   - 初始化票据：${params.bootstrapToken}`,
    '3. 更新 0-System/about-me/IDENTITY.md、0-System/about-me/USER.md、0-System/about-me/MEMORY.md。',
    '   - 确保存在 0-System/memory/ 目录，并写入一条当天初始化记录（YYYY-MM-DD.md）。',
    '4. 执行冲突对齐（必须）：',
    `   - 校验并修正 ${workspaceDir}/CLAUDE.md：保持 bridge-only，不要写死助手名/用户称呼。`,
    `   - 若 ${legacyGlobalMemoryPath} 存在：将“助手名称/对用户称呼/交互角色设定”同步为与 about-me 一致。`,
    '   - 清理别名或旧称呼（如“小花”“大辉哥”等）带来的同字段多真值。',
    '5. 初始化完成后，把 0-System/about-me/BOOTSTRAP.md 归档到 5-Archive/bootstrap/，不要保留在原位置。',
    '',
    '输出要求：最后用简洁中文汇报“已完成初始化”，并列出你实际修改的文件路径与“冲突对齐结果”。',
  ].join('\n');
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
      const aboutMeDir = `${workspaceDir}/0-System/about-me`;
      const aboutMeBootstrapPath = `${aboutMeDir}/BOOTSTRAP.md`;
      const templateDir = '/opt/mycc/templates/user-workspace';

      const sshPool = getSSHPool();
      const connection = await sshPool.acquire();

      try {
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const preflightCmd = [
          `sudo test -d "${workspaceDir}"`,
          `sudo test -f "${claudeMdPath}"`,
          `sudo test -f "${aboutMeBootstrapPath}"`,
        ].join(' && ');

        let preflight = await sshPool.exec(connection, preflightCmd);
        if (preflight.exitCode !== 0) {
          const repairCmd = [
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

        const migrateLegacyMarkdownCmd = `
          sudo mkdir -p "${aboutMeDir}" &&
          for f in AGENTS.md BOOTSTRAP.md HEARTBEAT.md IDENTITY.md SOUL.md TOOLS.md USER.md MEMORY.md; do
            if [ -f "${workspaceDir}/$f" ]; then
              if [ -f "${aboutMeDir}/$f" ]; then
                sudo rm -f "${workspaceDir}/$f";
              else
                sudo mv "${workspaceDir}/$f" "${aboutMeDir}/$f";
              fi
            fi
          done &&
          sudo cp "${templateDir}/CLAUDE.md" "${claudeMdPath}"
        `.trim();
        const migrated = await sshPool.exec(connection, migrateLegacyMarkdownCmd);
        if (migrated.exitCode !== 0) {
          console.error(`❌ Onboarding 目录迁移失败 userId=${request.user.userId} linuxUser=${linuxUser}: ${migrated.stderr}`);
          return reply.status(500).send({
            success: false,
            error: '初始化目录迁移失败，请重试',
          });
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

      clearExpiredOnboardingBootstrapTickets();
      const ticket = issueOnboardingBootstrapTicket({
        userId: request.user.userId,
        assistantName: body.assistantName.trim(),
        ownerName: body.ownerName.trim(),
      });
      const bootstrapPrompt = buildBootstrapPrompt({
        assistantName: body.assistantName,
        ownerName: body.ownerName,
        linuxUser,
        bootstrapToken: ticket.token,
      });

      return reply.send({
        success: true,
        data: {
          bootstrapPrompt,
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
