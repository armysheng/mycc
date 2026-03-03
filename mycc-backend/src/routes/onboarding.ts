import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById, markUserInitialized } from '../db/client.js';
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
      const templateDir = '/opt/mycc/templates/user-workspace';

      // 使用 node -e 做文件替换，避免 shell 插值注入风险
      // 将用户输入 Base64 编码后传入，在 node 内部解码并做纯字符串替换
      const assistantB64 = Buffer.from(body.assistantName).toString('base64');
      const ownerB64 = Buffer.from(body.ownerName).toString('base64');

      const nodeScript = [
        `const fs=require("fs");`,
        `const a=Buffer.from("${assistantB64}","base64").toString();`,
        `const o=Buffer.from("${ownerB64}","base64").toString();`,
        `const f="${claudeMdPath}";`,
        `const ws="${workspaceDir}";`,
        `let c=fs.readFileSync(f,"utf8");`,
        `c=c.split("{{USERNAME}}").join(o);`,
        `if(c.includes("{{ASSISTANT_NAME}}")||c.includes("{{OWNER_NAME}}")){`,
        `  c=c.split("{{ASSISTANT_NAME}}").join(a);`,
        `  c=c.split("{{OWNER_NAME}}").join(o);`,
        `}else{`,
        `  c=c.replace(/我叫\\s+\\*\\*[^*]+\\*\\*，是\\s+.*?\\s+的个人助手（Claude Code 的简称）。/g,"我叫 **"+a+"**，是 "+o+" 的个人助手（Claude Code 的简称）。");`,
        `  c=c.replace(/我和\\s+.*?\\s+是搭档，一起写代码、做项目、把事情做成。/g,"我和 "+o+" 是搭档，一起写代码、做项目、把事情做成。");`,
        `}`,
        `fs.writeFileSync(f,c);`,
        `const identityPath=ws+"/IDENTITY.md";`,
        `const userPath=ws+"/USER.md";`,
        `const memoryPath=ws+"/MEMORY.md";`,
        `if(!fs.existsSync(identityPath)){`,
        `  fs.writeFileSync(identityPath,["# IDENTITY.md - 我是谁？","","- **名称：** "+a,"- **生物类型：** AI 助手","- **气质：** 可靠、直接、务实","- **表情符号：** 🤖",""].join("\\n"));`,
        `}`,
        `if(!fs.existsSync(userPath)){`,
        `  fs.writeFileSync(userPath,["# USER.md - 关于你的用户","","- **姓名：** "+o,"- **称呼方式：** "+o,"- **代词：** （可选）","- **时区：** Asia/Shanghai","- **备注：**",""].join("\\n"));`,
        `}`,
        `if(!fs.existsSync(memoryPath) || !fs.readFileSync(memoryPath,"utf8").trim()){`,
        `  fs.writeFileSync(memoryPath,["# MEMORY.md","","## 长期偏好","- 助手名称："+a,"- 对用户称呼："+o,"- 回复风格：先结论，后细节，保持简洁。",""].join("\\n"));`,
        `}`,
      ].join('');

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
          const safeNickname = (user.nickname || '用户')
            .replace(/[/&\\]/g, '\\$&')
            .replace(/'/g, `'\"'\"'`);
          const repairCmd = [
            // 容错注册并发创建：避免「id 检查通过时序变化导致 useradd 报已存在」中断整条命令
            `(id ${escapeShellArg(linuxUser)} >/dev/null 2>&1 || sudo useradd -m -g mycc -s /bin/bash ${escapeShellArg(linuxUser)} || true)`,
            `id ${escapeShellArg(linuxUser)} >/dev/null 2>&1`,
            `sudo mkdir -p "${workspaceDir}"`,
            `sudo test -d "${templateDir}"`,
            `sudo cp -rn "${templateDir}/." "${workspaceDir}/"`,
            `sudo cp "${templateDir}/CLAUDE.md" "${claudeMdPath}"`,
            `sudo find "${workspaceDir}" -type f \\( -name '*.md' -o -name '*.json' \\) -exec sed -i 's/{{USERNAME}}/${safeNickname}/g' {} +`,
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

        const cmd = `sudo -n -u ${escapeShellArg(linuxUser)} node -e '${nodeScript}'`;
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
