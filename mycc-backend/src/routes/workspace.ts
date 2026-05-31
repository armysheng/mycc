import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { JWTPayload } from '../auth/service.js';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { isLikelyStaleE2bSessionError } from '../ide/e2b-session-errors.js';
import { buildE2bCodeServerSessionPlan } from '../ide/service.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { getSSHPool } from '../ssh/pool.js';
import type { SSHExecResult } from '../ssh/types.js';
import { escapeShellArg, sanitizeLinuxUsername } from '../utils/validation.js';

class WorkspaceRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'WorkspaceRouteError';
  }
}

type RunCommand = (command: string, timeoutMs?: number) => Promise<SSHExecResult>;
type WorkspaceProviderKind = 'ssh' | 'e2b';
type WorkspaceCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};
type WorkspaceCommandRunner = {
  provider: WorkspaceProviderKind;
  linuxUser: string;
  workspaceRoot: string;
  useSudo: boolean;
  run: (command: string, timeoutMs?: number) => Promise<WorkspaceCommandResult>;
};
type E2bWorkspaceProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>;

export type WorkspaceRoutesOptions = {
  env?: NodeJS.ProcessEnv;
  e2bProvider?: E2bWorkspaceProvider;
  ideSessionStore?: IdeSessionStore;
};

const treeQuerySchema = z.object({
  path: z.string().optional().default('/'),
  depth: z.coerce.number().int().min(1).max(6).optional().default(3),
});

const fileQuerySchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
});

const saveFileSchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
  content: z.string().max(120 * 1024, '文件内容过大，最大 120KB'),
});

const execSchema = z.object({
  command: z.string().trim().min(1, '命令不能为空').max(2000, '命令过长'),
  cwd: z.string().optional().default('/'),
});

const TREE_SCRIPT = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const root=path.resolve(process.argv[1]);',
  'const rel=(process.argv[2]||".").replace(/^\\/+/,"");',
  'const maxDepth=Math.max(1,Math.min(6,Number.parseInt(process.argv[3]||"3",10)||3));',
  'const maxNodes=Math.max(200,Math.min(5000,Number.parseInt(process.argv[4]||"1200",10)||1200));',
  'const rootReal=fs.realpathSync(root);',
  'const target=path.resolve(root,rel||".");',
  'const targetReal=fs.realpathSync(target);',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'if(!inside(rootReal,targetReal)) throw new Error("path-outside-workspace");',
  'let counter=0;',
  'const byType=(a,b)=>{const ad=a.isDirectory()?0:1;const bd=b.isDirectory()?0:1;if(ad!==bd)return ad-bd;return a.name.localeCompare(b.name,"zh-Hans-CN");};',
  'function scan(abs,depth){',
  '  const stat=fs.statSync(abs);',
  '  const relPath=path.relative(rootReal,abs).split(path.sep).join("/");',
  '  const node={',
  '    id:"/"+relPath,',
  '    name:relPath?path.basename(abs):"workspace",',
  '    path:"/"+relPath,',
  '    type:stat.isDirectory()?"directory":"file",',
  '    size:stat.size,',
  '    mtime:new Date(stat.mtimeMs).toISOString(),',
  '  };',
  '  counter+=1;',
  '  if(counter>=maxNodes)return node;',
  '  if(stat.isDirectory()&&depth<maxDepth){',
  '    const entries=fs.readdirSync(abs,{withFileTypes:true}).sort(byType);',
  '    const children=[];',
  '    for(const entry of entries){',
  '      if(counter>=maxNodes)break;',
  '      if(entry.name.startsWith("."))continue;',
  '      const full=path.join(abs,entry.name);',
  '      let lst;',
  '      try{lst=fs.lstatSync(full);}catch{continue;}',
  '      if(lst.isSymbolicLink())continue;',
  '      const real=fs.realpathSync(full);',
  '      if(!inside(rootReal,real))continue;',
  '      children.push(scan(real,depth+1));',
  '    }',
  '    node.children=children;',
  '  }',
  '  return node;',
  '}',
  'const tree=scan(targetReal,0);',
  'process.stdout.write(JSON.stringify({tree,truncated:counter>=maxNodes,nodeCount:counter}));',
].join('');

const READ_FILE_SCRIPT = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const root=path.resolve(process.argv[1]);',
  'const rel=(process.argv[2]||".").replace(/^\\/+/,"");',
  'const maxBytes=1024*1024;',
  'const rootReal=fs.realpathSync(root);',
  'const abs=path.resolve(root,rel||".");',
  'const absReal=fs.realpathSync(abs);',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'if(!inside(rootReal,absReal)) throw new Error("path-outside-workspace");',
  'const stat=fs.statSync(absReal);',
  'if(stat.isDirectory()) throw new Error("path-is-directory");',
  'const source=fs.readFileSync(absReal);',
  'const truncated=source.length>maxBytes;',
  'const buf=truncated?source.subarray(0,maxBytes):source;',
  'const binary=buf.includes(0);',
  'const relPath=path.relative(rootReal,absReal).split(path.sep).join("/");',
  'process.stdout.write(JSON.stringify({',
  '  path:"/"+relPath,',
  '  size:stat.size,',
  '  mtime:new Date(stat.mtimeMs).toISOString(),',
  '  truncated,',
  '  binary,',
  '  content:binary?null:buf.toString("utf8"),',
  '}));',
].join('');

const WRITE_FILE_SCRIPT = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const root=path.resolve(process.argv[1]);',
  'const rel=(process.argv[2]||".").replace(/^\\/+/,"");',
  'const content=process.argv[3]||"";',
  'const maxBytes=120*1024;',
  'if(Buffer.byteLength(content,"utf8")>maxBytes){throw new Error("content-too-large");}',
  'const rootReal=fs.realpathSync(root);',
  'const targetAbs=path.resolve(root,rel||".");',
  'const insideTarget=targetAbs===rootReal||targetAbs.startsWith(rootReal+path.sep);',
  'if(!insideTarget) throw new Error("path-outside-workspace");',
  'const parent=path.dirname(targetAbs);',
  'const parentReal=fs.realpathSync(parent);',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'if(!inside(rootReal,parentReal)) throw new Error("path-outside-workspace");',
  'if(fs.existsSync(targetAbs)){',
  '  const lst=fs.lstatSync(targetAbs);',
  '  if(lst.isDirectory()) throw new Error("path-is-directory");',
  '  if(lst.isSymbolicLink()) throw new Error("path-is-symlink");',
  '}',
  'fs.writeFileSync(targetAbs,content,"utf8");',
  'const stat=fs.statSync(targetAbs);',
  'const relPath=path.relative(rootReal,targetAbs).split(path.sep).join("/");',
  'process.stdout.write(JSON.stringify({',
  '  path:"/"+relPath,',
  '  size:stat.size,',
  '  mtime:new Date(stat.mtimeMs).toISOString(),',
  '}));',
].join('');

const EXEC_SCRIPT = [
  'const fs=require("fs");',
  'const path=require("path");',
  'const cp=require("child_process");',
  'const root=path.resolve(process.argv[1]);',
  'const rel=(process.argv[2]||".").replace(/^\\/+/,"");',
  'const command=process.argv[3]||"";',
  'const rootReal=fs.realpathSync(root);',
  'const cwd=path.resolve(root,rel||".");',
  'const cwdReal=fs.realpathSync(cwd);',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'if(!inside(rootReal,cwdReal)) throw new Error("path-outside-workspace");',
  'const result=cp.spawnSync("/bin/bash",["-lc",command],{',
  '  cwd:cwdReal,',
  '  encoding:"utf8",',
  '  timeout:120000,',
  '  maxBuffer:1024*1024,',
  '});',
  'const limit=(text)=>{if(!text)return"";if(text.length<=20000)return text;return text.slice(0,20000)+"\\n...[truncated]";};',
  'process.stdout.write(JSON.stringify({',
  '  cwd:"/"+path.relative(rootReal,cwdReal).split(path.sep).join("/"),',
  '  exitCode:typeof result.status==="number"?result.status:(result.error?1:0),',
  '  stdout:limit(result.stdout||""),',
  '  stderr:limit(result.stderr||""),',
  '  timedOut:!!(result.error&&result.error.message&&String(result.error.message).includes("timed out")),',
  '}));',
].join('');

function sendWorkspaceError(reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      success: false,
      error: '参数错误',
      details: err.issues,
    });
  }
  if (err instanceof WorkspaceRouteError) {
    return reply.status(err.statusCode).send({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
  return reply.status(500).send({
    success: false,
    error: '工作区暂不可用，请稍后重试',
    code: 'workspace_unavailable',
  });
}

export function normalizeWorkspacePath(rawPath?: string): string {
  const input = (rawPath || '/').trim();
  if (!input || input === '/') return '.';
  const cleaned = input.replace(/\\/g, '/');
  const withoutPrefix = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
  const normalized = path.posix.normalize(withoutPrefix);
  if (!normalized || normalized === '.') return '.';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new WorkspaceRouteError(400, '非法路径');
  }
  return normalized;
}

export function isWorkspaceExecEnabled(): boolean {
  return process.env.WORKSPACE_EXEC_ENABLED === 'true';
}

export function resolveWorkspaceProviderKind(env: NodeJS.ProcessEnv = process.env): WorkspaceProviderKind {
  const provider = (env.MYCC_WORKSPACE_PROVIDER || 'ssh').trim();
  if (provider === 'ssh' || provider === 'e2b') {
    return provider;
  }
  throw new Error(`Unsupported workspace provider: ${provider}`);
}

async function runNodeTask<T>(
  runner: WorkspaceCommandRunner,
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<T> {
  const commandArgs = args.map((arg) => escapeShellArg(arg)).join(' ');
  const nodeCommand = `node -e ${escapeShellArg(script)} -- ${commandArgs}`;
  const command = runner.useSudo
    ? `sudo -n -u ${escapeShellArg(runner.linuxUser)} ${nodeCommand}`
    : nodeCommand;
  const result = await runner.run(command, timeoutMs);

  if (result.exitCode !== 0) {
    const stderr = (result.stderr || result.error || '').trim();
    if (stderr.includes('path-outside-workspace') || stderr.includes('ENOENT')) {
      throw new WorkspaceRouteError(400, '路径不存在或越界');
    }
    if (stderr.includes('path-is-directory')) {
      throw new WorkspaceRouteError(400, '目标是目录，不支持该操作');
    }
    if (stderr.includes('path-is-symlink')) {
      throw new WorkspaceRouteError(400, '不支持软链接路径写入');
    }
    if (stderr.includes('content-too-large')) {
      throw new WorkspaceRouteError(400, '文件内容过大，最大 120KB');
    }
    throw new WorkspaceRouteError(500, '工作区暂不可用，请稍后重试', 'workspace_unavailable');
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    throw new WorkspaceRouteError(500, '工作区暂不可用，请稍后重试', 'workspace_unavailable');
  }

  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new WorkspaceRouteError(500, '工作区暂不可用，请稍后重试', 'workspace_unavailable');
  }
}

export async function workspaceRoutes(fastify: FastifyInstance, options: WorkspaceRoutesOptions = {}) {
  const env = options.env ?? process.env;
  const sessionStore = options.ideSessionStore ?? new PostgresIdeSessionStore();
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();

  const withSshRunner = async <T>(
    linuxUserRaw: string,
    handler: (runner: WorkspaceCommandRunner) => Promise<T>,
  ) => {
    const linuxUser = sanitizeLinuxUsername(linuxUserRaw);
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    const run: RunCommand = (command: string, timeoutMs: number = 30000): Promise<SSHExecResult> => {
      return sshPool.exec(connection, command, { timeout: timeoutMs });
    };

    try {
      return await handler({
        provider: 'ssh',
        linuxUser,
        workspaceRoot: `/home/${linuxUser}/workspace`,
        useSudo: true,
        run,
      });
    } finally {
      sshPool.release(connection);
    }
  };

  const withE2bRunner = async <T>(
    user: JWTPayload,
    handler: (runner: WorkspaceCommandRunner) => Promise<T>,
  ) => {
    const linuxUser = sanitizeLinuxUsername(user.linuxUser);
    const plan = buildE2bCodeServerSessionPlan({
      userId: user.userId,
      linuxUser,
      workspaceDir: `/home/${linuxUser}/workspace`,
    }, env);
    const session = await sessionStore.findReusableByUser(user.userId);
    if (!session) {
      throw new WorkspaceRouteError(409, '需要先打开代码编辑器', 'needs_workspace');
    }

    const run = async (command: string, timeoutMs: number = 30000): Promise<WorkspaceCommandResult> => {
      try {
        return await e2bProvider.runCommandInSession(session as StoredIdeSession, command, {
          cwd: plan.workspaceDir,
          timeoutMs,
        });
      } catch (error) {
        if (isLikelyStaleE2bSessionError(error)) {
          await sessionStore.set({ ...session, status: 'stopped' });
          throw new WorkspaceRouteError(
            409,
            '工作区会话已过期，请重新打开代码编辑器',
            'workspace_stale',
          );
        }
        throw new WorkspaceRouteError(
          500,
          '工作区暂不可用，请稍后重试',
          'workspace_unavailable',
        );
      }
    };

    return handler({
      provider: 'e2b',
      linuxUser: plan.linuxUser,
      workspaceRoot: plan.workspaceDir,
      useSudo: false,
      run,
    });
  };

  const withWorkspaceRunner = async <T>(
    user: JWTPayload,
    handler: (runner: WorkspaceCommandRunner) => Promise<T>,
  ) => {
    const provider = resolveWorkspaceProviderKind(env);
    if (provider === 'e2b') {
      return withE2bRunner(user, handler);
    }
    return withSshRunner(user.linuxUser, handler);
  };

  fastify.get('/api/workspace/tree', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    try {
      const query = treeQuerySchema.parse(request.query);
      const relPath = normalizeWorkspacePath(query.path);

      const data = await withWorkspaceRunner(request.user, async (runner) => {
        return runNodeTask<{
          tree: Record<string, unknown>;
          truncated: boolean;
          nodeCount: number;
        }>(
          runner,
          TREE_SCRIPT,
          [runner.workspaceRoot, relPath, String(query.depth), '1600'],
          30000,
        );
      });

      return reply.send({
        success: true,
        data,
      });
    } catch (err) {
      return sendWorkspaceError(reply, err);
    }
  });

  fastify.get('/api/workspace/file', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    try {
      const query = fileQuerySchema.parse(request.query);
      const relPath = normalizeWorkspacePath(query.path);

      const file = await withWorkspaceRunner(request.user, async (runner) => {
        return runNodeTask<{
          path: string;
          size: number;
          mtime: string;
          truncated: boolean;
          binary: boolean;
          content: string | null;
        }>(
          runner,
          READ_FILE_SCRIPT,
          [runner.workspaceRoot, relPath],
          30000,
        );
      });

      return reply.send({
        success: true,
        data: file,
      });
    } catch (err) {
      return sendWorkspaceError(reply, err);
    }
  });

  fastify.put('/api/workspace/file', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    try {
      const body = saveFileSchema.parse(request.body);
      const relPath = normalizeWorkspacePath(body.path);

      const saved = await withWorkspaceRunner(request.user, async (runner) => {
        return runNodeTask<{
          path: string;
          size: number;
          mtime: string;
        }>(
          runner,
          WRITE_FILE_SCRIPT,
          [runner.workspaceRoot, relPath, body.content],
          30000,
        );
      });

      return reply.send({
        success: true,
        data: saved,
      });
    } catch (err) {
      return sendWorkspaceError(reply, err);
    }
  });

  if (isWorkspaceExecEnabled()) {
    fastify.post('/api/workspace/exec', {
      preHandler: jwtAuthMiddleware,
    }, async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ success: false, error: '未认证' });
      }
      if (request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: '无权限使用工作区命令执行' });
      }

      try {
        const body = execSchema.parse(request.body);
        const relCwd = normalizeWorkspacePath(body.cwd);

        const result = await withWorkspaceRunner(request.user, async (runner) => {
          return runNodeTask<{
            cwd: string;
            exitCode: number;
            stdout: string;
            stderr: string;
            timedOut: boolean;
          }>(
            runner,
            EXEC_SCRIPT,
            [runner.workspaceRoot, relCwd, body.command],
            125000,
          );
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (err) {
        return sendWorkspaceError(reply, err);
      }
    });
  }
}
