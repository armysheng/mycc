import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById, markUserInitialized } from '../db/client.js';
import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

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
      const claudeMdPath = `/home/${linuxUser}/workspace/CLAUDE.md`;

      // 使用 node -e 做文件替换，避免 shell 插值注入风险
      // 将用户输入 Base64 编码后传入，在 node 内部解码并做纯字符串替换
      const assistantB64 = Buffer.from(body.assistantName).toString('base64');
      const ownerB64 = Buffer.from(body.ownerName).toString('base64');

      const nodeScript = [
        `const fs=require("fs");`,
        `const a=Buffer.from("${assistantB64}","base64").toString();`,
        `const o=Buffer.from("${ownerB64}","base64").toString();`,
        `const f="${claudeMdPath}";`,
        `let c=fs.readFileSync(f,"utf8");`,
        `c=c.split("{{ASSISTANT_NAME}}").join(a);`,
        `c=c.split("{{OWNER_NAME}}").join(o);`,
        `fs.writeFileSync(f,c);`,
      ].join('');

      const sshPool = getSSHPool();
      const connection = await sshPool.acquire();

      try {
        const preflightCmd = [
          `sudo test -d "${workspaceDir}"`,
          `sudo test -f "${claudeMdPath}"`,
          `sudo grep -q "{{ASSISTANT_NAME}}" "${claudeMdPath}"`,
          `sudo grep -q "{{OWNER_NAME}}" "${claudeMdPath}"`,
        ].join(' && ');
        const preflight = await sshPool.exec(connection, preflightCmd);
        if (preflight.exitCode !== 0) {
          console.error(`❌ Onboarding 目录或模板异常 userId=${request.user.userId} linuxUser=${linuxUser} path=${claudeMdPath}`);
          return reply.status(500).send({
            success: false,
            error: '初始化目录或模板异常，请联系管理员',
          });
        }

        const cmd = `sudo node -e '${nodeScript}'`;
        const result = await sshPool.exec(connection, cmd);
        if (result.exitCode !== 0) {
          console.error(`❌ Onboarding 变量替换失败: ${result.stderr}`);
          return reply.status(500).send({
            success: false,
            error: '初始化文件写入失败，请重试',
          });
        }
      } finally {
        sshPool.release(connection);
      }

      // 只有文件替换成功才标记初始化完成
      await markUserInitialized(request.user.userId);

      return reply.send({ success: true });
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
