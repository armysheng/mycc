#!/usr/bin/env tsx

import dotenv from 'dotenv';
import fs from 'node:fs';
import { pool } from '../src/db/client.js';
import { getSSHPool, initSSHPool } from '../src/ssh/pool.js';
import type { SSHConfig } from '../src/ssh/types.js';
import { escapeShellArg, sanitizeLinuxUsername } from '../src/utils/validation.js';

type TargetUser = {
  id: number;
  linux_user: string;
  status: string;
  is_initialized?: boolean;
};

type ScriptOptions = {
  dryRun: boolean;
  includeUninitialized: boolean;
  userId?: number;
  linuxUser?: string;
  limit?: number;
  defaultRole: string;
};

type ReconcileResult = {
  workspaceExists: boolean;
  processed: boolean;
  skippedReason?: string;
  assistantName?: string;
  ownerName?: string;
  roleSetting?: string;
  updatedIdentity: boolean;
  updatedUser: boolean;
  updatedAboutMemory: boolean;
  updatedLegacyMemory: boolean;
  legacyMemoryExists: boolean;
};

const ABOUT_ME_DIR = '0-System/about-me';

function printUsage(): void {
  console.log(`
用法:
  npx tsx scripts/reconcile-legacy-identity-conflicts.ts [选项]

选项:
  --dry-run                 仅检查并输出变更计划，不执行写入
  --user-id <id>            仅处理指定用户 ID
  --linux-user <name>       仅处理指定 linux_user
  --limit <n>               最多处理 n 个用户
  --include-uninitialized   包含 is_initialized=false 的用户
  --default-role <text>     当 about-me 缺失角色设定时使用的默认值
  --help                    显示帮助

示例:
  npx tsx scripts/reconcile-legacy-identity-conflicts.ts --dry-run --limit 20
  npx tsx scripts/reconcile-legacy-identity-conflicts.ts --linux-user mycc_u2
`);
}

function parseOptions(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    dryRun: false,
    includeUninitialized: false,
    defaultRole: '工程搭档型 AI 助手',
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
    if (arg === '--default-role') {
      const raw = (argv[i + 1] || '').trim();
      if (!raw) throw new Error('--default-role 缺少参数');
      if (raw.length > 120) throw new Error('--default-role 最长 120 字符');
      options.defaultRole = raw;
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

async function queryUsers(options: ScriptOptions): Promise<TargetUser[]> {
  const hasInitializedColumn = await checkUsersHasColumn('is_initialized');
  const conditions: string[] = ['status = $1'];
  const params: Array<string | number | boolean> = ['active'];

  if (!options.includeUninitialized && hasInitializedColumn) {
    conditions.push(`is_initialized = $${params.length + 1}`);
    params.push(true);
  }

  if (options.userId) {
    conditions.push(`id = $${params.length + 1}`);
    params.push(options.userId);
  }

  if (options.linuxUser) {
    conditions.push(`linux_user = $${params.length + 1}`);
    params.push(options.linuxUser);
  }

  const selectInitialized = hasInitializedColumn
    ? 'is_initialized'
    : 'NULL::boolean as is_initialized';
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';
  const sql = `
    SELECT id, linux_user, status, ${selectInitialized}
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
    ${limitClause}
  `;
  const result = await pool.query<TargetUser>(sql, params);
  return result.rows;
}

function buildReconcileScript(params: {
  linuxUser: string;
  defaultRole: string;
  dryRun: boolean;
}): string {
  const workspaceDir = `/home/${params.linuxUser}/workspace`;
  const aboutMeDir = `${workspaceDir}/${ABOUT_ME_DIR}`;
  const projectUserSegment = params.linuxUser.replace(/_/g, '-');
  const legacyGlobalMemoryPath = `/home/${params.linuxUser}/.claude/projects/-home-${projectUserSegment}-workspace/memory/MEMORY.md`;
  return [
    'const fs=require("fs");',
    'const path=require("path");',
    `const dryRun=${params.dryRun ? 'true' : 'false'};`,
    `const workspaceDir=${JSON.stringify(workspaceDir)};`,
    `const aboutMeDir=${JSON.stringify(aboutMeDir)};`,
    `const identityPath=${JSON.stringify(`${aboutMeDir}/IDENTITY.md`)};`,
    `const userPath=${JSON.stringify(`${aboutMeDir}/USER.md`)};`,
    `const aboutMemoryPath=${JSON.stringify(`${aboutMeDir}/MEMORY.md`)};`,
    `const legacyMemoryPath=${JSON.stringify(legacyGlobalMemoryPath)};`,
    `const defaultRole=${JSON.stringify(params.defaultRole)};`,
    'const out={workspaceExists:fs.existsSync(workspaceDir),processed:false,updatedIdentity:false,updatedUser:false,updatedAboutMemory:false,updatedLegacyMemory:false,legacyMemoryExists:fs.existsSync(legacyMemoryPath)};',
    'if(!out.workspaceExists){ out.skippedReason="workspace_missing"; process.stdout.write(JSON.stringify(out)); process.exit(0); }',
    'if(!fs.existsSync(identityPath) || !fs.existsSync(userPath) || !fs.existsSync(aboutMemoryPath)){',
    '  out.skippedReason="about_me_required_files_missing";',
    '  process.stdout.write(JSON.stringify(out));',
    '  process.exit(0);',
    '}',
    'const read=(p)=>{ try{return fs.readFileSync(p,"utf8");}catch{return "";} };',
    'const normalize=(v)=>{',
    '  if(!v) return "";',
    '  return v.replace(/^["\\\'\\s]+|["\\\'\\s]+$/g,"").replace(/\\*\\*/g,"").trim();',
    '};',
    'const findField=(content, keys)=>{',
    '  for(const key of keys){',
    '    const re=new RegExp(String.raw`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${key}(?:\\*\\*)?\\s*[：:]\\s*(.+?)\\s*$`,"m");',
    '    const m=content.match(re);',
    '    if(m && m[1]){',
    '      const val=normalize(m[1]);',
    '      if(val) return val;',
    '    }',
    '  }',
    '  return "";',
    '};',
    'const upsertCanonicalField=(content, aliasKeys, canonicalKey, value)=>{',
    '  const lines=content.split(/\\r?\\n/);',
    '  const keys=new Set(aliasKeys.map((k)=>k.toLowerCase()));',
    '  let replaced=false;',
    '  const outLines=[];',
    '  for(const line of lines){',
    '    const m=line.match(/^\\s*[-*]\\s*(?:\\*\\*)?([^：:]+?)(?:\\*\\*)?\\s*[：:]\\s*(.*?)\\s*$/);',
    '    if(!m){ outLines.push(line); continue; }',
    '    const key=normalize(m[1]).toLowerCase();',
    '    if(!keys.has(key)){ outLines.push(line); continue; }',
    '    if(!replaced){',
    '      outLines.push(`- ${canonicalKey}：${value}`);',
    '      replaced=true;',
    '    }',
    '  }',
    '  if(!replaced){',
    '    if(outLines.length>0 && outLines[outLines.length-1].trim()!==""){ outLines.push(""); }',
    '    outLines.push(`- ${canonicalKey}：${value}`);',
    '  }',
    '  return outLines.join("\\n");',
    '};',
    'const identityRaw=read(identityPath);',
    'const userRaw=read(userPath);',
    'const aboutMemoryRaw=read(aboutMemoryPath);',
    'const assistantName=findField(identityRaw,["助手名称","名称"])||findField(aboutMemoryRaw,["助手名称"]);',
    'const ownerName=findField(userRaw,["用户称呼","称呼方式","姓名"])||findField(aboutMemoryRaw,["对用户称呼","用户称呼"]);',
    'const roleSetting=findField(identityRaw,["角色设定","角色定位"])||findField(aboutMemoryRaw,["交互角色设定","角色设定"])||defaultRole;',
    'if(!assistantName || !ownerName){',
    '  out.skippedReason="canonical_fields_missing";',
    '  out.assistantName=assistantName || undefined;',
    '  out.ownerName=ownerName || undefined;',
    '  process.stdout.write(JSON.stringify(out));',
    '  process.exit(0);',
    '}',
    'let identityNext=identityRaw;',
    'identityNext=upsertCanonicalField(identityNext,["助手名称","名称"],"助手名称",assistantName);',
    'identityNext=upsertCanonicalField(identityNext,["角色设定","角色定位"],"角色设定",roleSetting);',
    'let userNext=userRaw;',
    'userNext=upsertCanonicalField(userNext,["用户称呼","称呼方式","姓名"],"用户称呼",ownerName);',
    'let aboutMemoryNext=aboutMemoryRaw;',
    'aboutMemoryNext=upsertCanonicalField(aboutMemoryNext,["助手名称"],"助手名称",assistantName);',
    'aboutMemoryNext=upsertCanonicalField(aboutMemoryNext,["对用户称呼","用户称呼"],"对用户称呼",ownerName);',
    'aboutMemoryNext=upsertCanonicalField(aboutMemoryNext,["交互角色设定","角色设定"],"交互角色设定",roleSetting);',
    'out.updatedIdentity=identityNext!==identityRaw;',
    'out.updatedUser=userNext!==userRaw;',
    'out.updatedAboutMemory=aboutMemoryNext!==aboutMemoryRaw;',
    'if(out.legacyMemoryExists){',
    '  const legacyRaw=read(legacyMemoryPath);',
    '  let legacyNext=legacyRaw;',
    '  legacyNext=upsertCanonicalField(legacyNext,["助手名称"],"助手名称",assistantName);',
    '  legacyNext=upsertCanonicalField(legacyNext,["对用户称呼","用户称呼"],"对用户称呼",ownerName);',
    '  legacyNext=upsertCanonicalField(legacyNext,["交互角色设定","角色设定"],"交互角色设定",roleSetting);',
    '  out.updatedLegacyMemory=legacyNext!==legacyRaw;',
    '  if(!dryRun && out.updatedLegacyMemory){',
    '    fs.mkdirSync(path.dirname(legacyMemoryPath),{recursive:true});',
    '    fs.writeFileSync(legacyMemoryPath,legacyNext);',
    '  }',
    '}',
    'if(!dryRun){',
    '  if(out.updatedIdentity) fs.writeFileSync(identityPath,identityNext);',
    '  if(out.updatedUser) fs.writeFileSync(userPath,userNext);',
    '  if(out.updatedAboutMemory) fs.writeFileSync(aboutMemoryPath,aboutMemoryNext);',
    '}',
    'out.processed=true;',
    'out.assistantName=assistantName;',
    'out.ownerName=ownerName;',
    'out.roleSetting=roleSetting;',
    'process.stdout.write(JSON.stringify(out));',
  ].join('');
}

async function runForUser(user: TargetUser, options: ScriptOptions): Promise<ReconcileResult> {
  const linuxUser = sanitizeLinuxUsername(user.linux_user);
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();
  try {
    const script = buildReconcileScript({
      linuxUser,
      defaultRole: options.defaultRole,
      dryRun: options.dryRun,
    });
    const cmd = `sudo -n -u ${escapeShellArg(linuxUser)} node -e ${escapeShellArg(script)}`;
    const result = await sshPool.exec(connection, cmd, { timeout: 120_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'reconcile script failed');
    }
    return JSON.parse(result.stdout) as ReconcileResult;
  } finally {
    sshPool.release(connection);
  }
}

async function main(): Promise<void> {
  dotenv.config();
  const options = parseOptions(process.argv.slice(2));

  initSSHPool(getSSHConfigFromEnv());
  const sshPool = getSSHPool();

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let updatedIdentity = 0;
  let updatedUser = 0;
  let updatedAboutMemory = 0;
  let updatedLegacyMemory = 0;

  try {
    const users = await queryUsers(options);
    if (users.length === 0) {
      console.log('没有匹配到需要处理的用户。');
      return;
    }

    console.log(`共匹配到 ${users.length} 个用户，模式=${options.dryRun ? 'dry-run' : 'write'}`);
    for (const user of users) {
      try {
        const result = await runForUser(user, options);
        if (!result.processed) {
          skipped += 1;
          console.log(
            `[SKIP] user=${user.id}/${user.linux_user} reason=${result.skippedReason || 'unknown'} ` +
              `assistant=${result.assistantName || '-'} owner=${result.ownerName || '-'}`,
          );
          continue;
        }

        ok += 1;
        updatedIdentity += result.updatedIdentity ? 1 : 0;
        updatedUser += result.updatedUser ? 1 : 0;
        updatedAboutMemory += result.updatedAboutMemory ? 1 : 0;
        updatedLegacyMemory += result.updatedLegacyMemory ? 1 : 0;

        console.log(
          `[OK] user=${user.id}/${user.linux_user} assistant=${result.assistantName} owner=${result.ownerName} ` +
            `role=${result.roleSetting} ` +
            `changed(identity/user/about/legacy)=` +
            `${result.updatedIdentity ? 1 : 0}/${result.updatedUser ? 1 : 0}/${result.updatedAboutMemory ? 1 : 0}/${result.updatedLegacyMemory ? 1 : 0}`,
        );
      } catch (err) {
        failed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[FAILED] user=${user.id}/${user.linux_user} reason=${reason}`);
      }
    }

    console.log('执行完成：');
    console.log(`- 成功处理: ${ok}`);
    console.log(`- 跳过: ${skipped}`);
    console.log(`- 失败: ${failed}`);
    console.log(`- identity 更新: ${updatedIdentity}`);
    console.log(`- user 更新: ${updatedUser}`);
    console.log(`- about-me memory 更新: ${updatedAboutMemory}`);
    console.log(`- legacy memory 更新: ${updatedLegacyMemory}`);
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

