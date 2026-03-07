#!/usr/bin/env tsx

import dotenv from 'dotenv';
import fs from 'node:fs';
import { pool } from '../src/db/client.js';
import { getSSHPool, initSSHPool } from '../src/ssh/pool.js';
import type { SSHConfig } from '../src/ssh/types.js';
import { escapeShellArg, sanitizeLinuxUsername } from '../src/utils/validation.js';

type LegacyUser = {
  id: number;
  linux_user: string;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  is_initialized?: boolean;
};

type ScriptOptions = {
  dryRun: boolean;
  includeUninitialized: boolean;
  userId?: number;
  linuxUser?: string;
  limit?: number;
  assistantName: string;
};

type BackfillResult = {
  createdIdentity: boolean;
  createdUser: boolean;
  createdMemory: boolean;
  updatedMemoryFromEmpty: boolean;
  replacedUsernamePlaceholders: number;
};

type DryRunResult = {
  workspaceExists: boolean;
  missingFiles: string[];
  usernamePlaceholderFiles: string[];
};

const TEMPLATE_DIR = '/opt/mycc/templates/user-workspace';
const ABOUT_ME_DIR = '0-System/about-me';
const REQUIRED_FILES = [
  'SOUL.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const;

function printUsage(): void {
  console.log(`
用法:
  npx tsx scripts/backfill-legacy-id-soul.ts [选项]

选项:
  --dry-run                 仅检查，不做写入
  --user-id <id>            仅处理指定用户 ID
  --linux-user <name>       仅处理指定 linux_user
  --limit <n>               最多处理 n 个用户
  --include-uninitialized   包含 is_initialized=false 的用户
  --assistant-name <name>   IDENTITY/MEMORY 默认助手名（默认: cc）
  --help                    显示帮助

示例:
  npx tsx scripts/backfill-legacy-id-soul.ts --dry-run --limit 20
  npx tsx scripts/backfill-legacy-id-soul.ts --linux-user mycc_u12
`);
}

function parseOptions(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    dryRun: false,
    includeUninitialized: false,
    assistantName: 'cc',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--include-uninitialized') {
      options.includeUninitialized = true;
      continue;
    }
    if (arg === '--user-id') {
      const raw = argv[i + 1];
      if (!raw) throw new Error('--user-id 缺少参数');
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--user-id 必须是正整数');
      options.userId = parsed;
      i += 1;
      continue;
    }
    if (arg === '--linux-user') {
      const raw = argv[i + 1];
      if (!raw) throw new Error('--linux-user 缺少参数');
      options.linuxUser = sanitizeLinuxUsername(raw);
      i += 1;
      continue;
    }
    if (arg === '--limit') {
      const raw = argv[i + 1];
      if (!raw) throw new Error('--limit 缺少参数');
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--limit 必须是正整数');
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (arg === '--assistant-name') {
      const raw = (argv[i + 1] || '').trim();
      if (!raw) throw new Error('--assistant-name 缺少参数');
      if (raw.length > 20) throw new Error('--assistant-name 最长 20 字符');
      options.assistantName = raw;
      i += 1;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  return options;
}

function getSSHConfigFromEnv(): SSHConfig {
  const host = process.env.VPS_HOST || '';
  const username = process.env.VPS_SSH_USER || '';
  const privateKeyPath = process.env.VPS_SSH_KEY_PATH || '';
  if (!host || !username || !privateKeyPath) {
    throw new Error('VPS SSH 配置不完整，请检查 VPS_HOST / VPS_SSH_USER / VPS_SSH_KEY_PATH');
  }
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`VPS_SSH_KEY_PATH 文件不存在: ${privateKeyPath}`);
  }

  return {
    host,
    port: Number.parseInt(process.env.VPS_SSH_PORT || '22', 10),
    username,
    privateKeyPath,
    maxConnections: Number.parseInt(process.env.VPS_SSH_MAX_CONNECTIONS || '5', 10),
    readyTimeoutMs: Number.parseInt(process.env.VPS_SSH_READY_TIMEOUT_MS || '30000', 10),
    forceIPv4: process.env.VPS_SSH_FORCE_IPV4 !== 'false',
    keepaliveIntervalMs: Number.parseInt(process.env.VPS_SSH_KEEPALIVE_INTERVAL_MS || '10000', 10),
    keepaliveCountMax: Number.parseInt(process.env.VPS_SSH_KEEPALIVE_COUNT_MAX || '3', 10),
  };
}

function pickOwnerName(user: LegacyUser): string {
  const raw = (user.nickname || user.phone || user.email || user.linux_user || '用户').trim();
  return raw || '用户';
}

async function queryUsers(options: ScriptOptions): Promise<LegacyUser[]> {
  const hasInitializedColumn = await checkUsersHasColumn('is_initialized');
  const conditions: string[] = ['status = $1'];
  const params: Array<string | number> = ['active'];

  if (!options.includeUninitialized && hasInitializedColumn) {
    conditions.push(`is_initialized = $${params.length + 1}`);
    params.push(true);
  } else if (!options.includeUninitialized && !hasInitializedColumn) {
    console.warn('[backfill:id-soul] users.is_initialized 列不存在，已降级为按 active 用户全量处理');
  }

  if (options.userId) {
    conditions.push(`id = $${params.length + 1}`);
    params.push(options.userId);
  }

  if (options.linuxUser) {
    conditions.push(`linux_user = $${params.length + 1}`);
    params.push(options.linuxUser);
  }

  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';
  const selectInitialized = hasInitializedColumn
    ? 'is_initialized'
    : 'NULL::boolean as is_initialized';
  const sql = `
    SELECT id, linux_user, nickname, phone, email, status, ${selectInitialized}
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
    ${limitClause}
  `;
  const result = await pool.query<LegacyUser>(sql, params);
  return result.rows;
}

async function checkUsersHasColumn(columnName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = $1
      ) AS exists
    `,
    [columnName],
  );
  return result.rows[0]?.exists === true;
}

function buildDryRunScript(workspaceDir: string): string {
  const files = REQUIRED_FILES.map((name) => `${workspaceDir}/${ABOUT_ME_DIR}/${name}`);
  const placeholderTargets = [
    `${workspaceDir}/CLAUDE.md`,
  ];

  return [
    'const fs=require("fs");',
    `const ws=${JSON.stringify(workspaceDir)};`,
    `const files=${JSON.stringify(files)};`,
    `const placeholderTargets=${JSON.stringify(placeholderTargets)};`,
    'const out={workspaceExists:fs.existsSync(ws),missingFiles:[],usernamePlaceholderFiles:[]};',
    'for(const filePath of files){ if(!fs.existsSync(filePath)){ out.missingFiles.push(filePath); } }',
    'for(const filePath of placeholderTargets){',
    '  try{',
    '    if(fs.existsSync(filePath)){',
    '      const content=fs.readFileSync(filePath,"utf8");',
    '      if(content.includes("{{USERNAME}}")){ out.usernamePlaceholderFiles.push(filePath); }',
    '    }',
    '  }catch{}',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ].join('');
}

function buildBackfillScript(params: {
  workspaceDir: string;
  ownerName: string;
  assistantName: string;
}): string {
  const legacyRootFiles = REQUIRED_FILES.map((name) => `${params.workspaceDir}/${name}`);
  return [
    'const fs=require("fs");',
    `const ws=${JSON.stringify(params.workspaceDir)};`,
    `const aboutDir=${JSON.stringify(`${params.workspaceDir}/${ABOUT_ME_DIR}`)};`,
    `const legacyRootFiles=${JSON.stringify(legacyRootFiles)};`,
    `const owner=${JSON.stringify(params.ownerName)};`,
    `const assistant=${JSON.stringify(params.assistantName)};`,
    'const identityPath=aboutDir+"/IDENTITY.md";',
    'const userPath=aboutDir+"/USER.md";',
    'const memoryPath=aboutDir+"/MEMORY.md";',
    'const placeholderTargets=[ws+"/CLAUDE.md"];',
    'const out={createdIdentity:false,createdUser:false,createdMemory:false,updatedMemoryFromEmpty:false,replacedUsernamePlaceholders:0};',
    'fs.mkdirSync(aboutDir,{recursive:true});',
    'for(const legacyPath of legacyRootFiles){',
    '  try{',
    '    if(!fs.existsSync(legacyPath)) continue;',
    '    const base=legacyPath.split("/").pop();',
    '    const target=aboutDir+"/"+base;',
    '    if(!fs.existsSync(target)){',
    '      fs.renameSync(legacyPath,target);',
    '    }',
    '  }catch{}',
    '}',
    'if(!fs.existsSync(identityPath)){',
    '  fs.writeFileSync(identityPath,["# IDENTITY.md - 我是谁？","","- **名称：** "+assistant,"- **生物类型：** AI 助手","- **气质：** 可靠、直接、务实","- **表情符号：** 🤖",""].join("\\n"));',
    '  out.createdIdentity=true;',
    '}',
    'if(!fs.existsSync(userPath)){',
    '  fs.writeFileSync(userPath,["# USER.md - 关于你的用户","","- **姓名：** "+owner,"- **称呼方式：** "+owner,"- **代词：** （可选）","- **时区：** Asia/Shanghai","- **备注：**",""].join("\\n"));',
    '  out.createdUser=true;',
    '}',
    'const memorySeed=["# MEMORY.md","","## 长期偏好","- 助手名称："+assistant,"- 对用户称呼："+owner,"- 回复风格：先结论，后细节，保持简洁。",""].join("\\n");',
    'if(!fs.existsSync(memoryPath)){',
    '  fs.writeFileSync(memoryPath,memorySeed);',
    '  out.createdMemory=true;',
    '}else{',
    '  const memoryRaw=fs.readFileSync(memoryPath,"utf8");',
    '  if(!memoryRaw.trim()){',
    '    fs.writeFileSync(memoryPath,memorySeed);',
    '    out.updatedMemoryFromEmpty=true;',
    '  }',
    '}',
    'for(const filePath of placeholderTargets){',
    '  try{',
    '    if(!fs.existsSync(filePath)) continue;',
    '    const content=fs.readFileSync(filePath,"utf8");',
    '    if(!content.includes("{{USERNAME}}")) continue;',
    '    fs.writeFileSync(filePath,content.split("{{USERNAME}}").join(owner));',
    '    out.replacedUsernamePlaceholders+=1;',
    '  }catch{}',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ].join('');
}

async function runDryRunForUser(user: LegacyUser): Promise<DryRunResult> {
  const linuxUser = sanitizeLinuxUsername(user.linux_user);
  const workspaceDir = `/home/${linuxUser}/workspace`;
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();
  try {
    const script = buildDryRunScript(workspaceDir);
    const cmd = `sudo node -e ${escapeShellArg(script)}`;
    const result = await sshPool.exec(connection, cmd, { timeout: 60_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `dry-run 执行失败（user=${linuxUser}）`);
    }
    const parsed = JSON.parse(result.stdout) as DryRunResult;
    return parsed;
  } finally {
    sshPool.release(connection);
  }
}

async function runBackfillForUser(user: LegacyUser, assistantName: string): Promise<BackfillResult> {
  const linuxUser = sanitizeLinuxUsername(user.linux_user);
  const workspaceDir = `/home/${linuxUser}/workspace`;
  const ownerName = pickOwnerName(user);
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();

  try {
    const ensureCmd = [
      `id ${escapeShellArg(linuxUser)} >/dev/null 2>&1 || sudo useradd -m -g mycc -s /bin/bash ${escapeShellArg(linuxUser)}`,
      `sudo mkdir -p "${workspaceDir}"`,
      `sudo test -d "${TEMPLATE_DIR}"`,
      `sudo cp -rn "${TEMPLATE_DIR}/." "${workspaceDir}/"`,
      `sudo chown -R ${escapeShellArg(linuxUser)}:mycc "${workspaceDir}"`,
    ].join(' && ');

    const ensure = await sshPool.exec(connection, ensureCmd, { timeout: 120_000 });
    if (ensure.exitCode !== 0) {
      throw new Error(ensure.stderr || `用户预处理失败（user=${linuxUser}）`);
    }

    const script = buildBackfillScript({
      workspaceDir,
      ownerName,
      assistantName,
    });
    const writeCmd = `sudo -n -u ${escapeShellArg(linuxUser)} node -e ${escapeShellArg(script)}`;
    const wrote = await sshPool.exec(connection, writeCmd, { timeout: 120_000 });
    if (wrote.exitCode !== 0) {
      throw new Error(wrote.stderr || `写入失败（user=${linuxUser}）`);
    }

    const chownCmd = `sudo chown -R ${escapeShellArg(linuxUser)}:mycc "${workspaceDir}"`;
    const chown = await sshPool.exec(connection, chownCmd, { timeout: 60_000 });
    if (chown.exitCode !== 0) {
      throw new Error(chown.stderr || `权限修复失败（user=${linuxUser}）`);
    }

    return JSON.parse(wrote.stdout) as BackfillResult;
  } finally {
    sshPool.release(connection);
  }
}

async function main(): Promise<void> {
  dotenv.config();
  const options = parseOptions(process.argv.slice(2));

  initSSHPool(getSSHConfigFromEnv());
  const sshPool = getSSHPool();

  let processed = 0;
  let failed = 0;
  let createdIdentity = 0;
  let createdUser = 0;
  let createdMemory = 0;
  let updatedEmptyMemory = 0;

  try {
    const users = await queryUsers(options);
    if (users.length === 0) {
      console.log('没有匹配到需要处理的用户。');
      return;
    }

    console.log(`共匹配到 ${users.length} 个用户，模式=${options.dryRun ? 'dry-run' : 'write'}`);
    for (const user of users) {
      try {
        if (options.dryRun) {
          const check = await runDryRunForUser(user);
          console.log(
            `[DRY-RUN] user=${user.id}/${user.linux_user} workspace=${check.workspaceExists ? 'ok' : 'missing'} ` +
              `missing=${check.missingFiles.length} placeholders=${check.usernamePlaceholderFiles.length}`,
          );
          if (check.missingFiles.length > 0) {
            console.log(`  missing:\n  - ${check.missingFiles.join('\n  - ')}`);
          }
        } else {
          const result = await runBackfillForUser(user, options.assistantName);
          processed += 1;
          createdIdentity += result.createdIdentity ? 1 : 0;
          createdUser += result.createdUser ? 1 : 0;
          createdMemory += result.createdMemory ? 1 : 0;
          updatedEmptyMemory += result.updatedMemoryFromEmpty ? 1 : 0;

          console.log(
            `[OK] user=${user.id}/${user.linux_user} created(identity/user/memory)=` +
              `${result.createdIdentity ? 1 : 0}/${result.createdUser ? 1 : 0}/${result.createdMemory ? 1 : 0} ` +
              `updatedEmptyMemory=${result.updatedMemoryFromEmpty ? 1 : 0} placeholders=${result.replacedUsernamePlaceholders}`,
          );
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[FAILED] user=${user.id}/${user.linux_user} reason=${message}`);
      }
    }

    if (options.dryRun) {
      console.log(`dry-run 完成，目标用户=${users.length}，失败=${failed}`);
      return;
    }

    console.log('补齐完成：');
    console.log(`- 处理成功用户: ${processed}`);
    console.log(`- 处理失败用户: ${failed}`);
    console.log(`- 新建 IDENTITY.md: ${createdIdentity}`);
    console.log(`- 新建 USER.md: ${createdUser}`);
    console.log(`- 新建 MEMORY.md: ${createdMemory}`);
    console.log(`- 修复空 MEMORY.md: ${updatedEmptyMemory}`);
  } finally {
    await pool.end();
    await sshPool.destroy();
  }
}

main().catch(async (err) => {
  console.error('执行失败:', err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
