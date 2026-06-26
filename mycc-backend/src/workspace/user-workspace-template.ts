import fs from 'node:fs';
import path from 'node:path';

export type WorkspaceTemplateFile = {
  path: string;
  contentBase64: string;
  overwrite: boolean;
};

type TemplateTransformOptions = {
  assistantName?: string;
  ownerName?: string;
  includeBootstrapSentinel?: boolean;
  overwrite?: (relativePath: string) => boolean;
};

const BOOTSTRAP_SENTINEL = '<!-- MYCC_BOOTSTRAP_REQUIRED -->';

export function resolveUserWorkspaceTemplateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MYCC_USER_WORKSPACE_TEMPLATE_DIR) return env.MYCC_USER_WORKSPACE_TEMPLATE_DIR;
  return path.resolve(process.cwd(), 'templates/user-workspace');
}

export function resolveUserClaudeHomeTemplateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MYCC_USER_CLAUDE_HOME_TEMPLATE_DIR) return env.MYCC_USER_CLAUDE_HOME_TEMPLATE_DIR;
  return resolveUserWorkspaceTemplateRoot(env);
}

export function listUserWorkspaceTemplateFiles(params: {
  templateRoot?: string;
  assistantName?: string;
  ownerName?: string;
  includeBootstrapSentinel?: boolean;
  overwrite?: (relativePath: string) => boolean;
} = {}): WorkspaceTemplateFile[] {
  return listTemplateFiles({
    templateRoot: params.templateRoot ?? resolveUserWorkspaceTemplateRoot(),
    mapPath: mapWorkspaceTemplatePath,
    transformContent: (relativePath, content) =>
      transformWorkspaceTemplateContent(relativePath, content, params),
    overwrite: params.overwrite,
  });
}

export function listUserClaudeHomeTemplateFiles(params: {
  templateRoot?: string;
  assistantName?: string;
  ownerName?: string;
  includeBootstrapSentinel?: boolean;
  overwrite?: (relativePath: string) => boolean;
} = {}): WorkspaceTemplateFile[] {
  return listTemplateFiles({
    templateRoot: params.templateRoot ?? resolveUserClaudeHomeTemplateRoot(),
    mapPath: mapClaudeHomeTemplatePath,
    transformContent: (relativePath, content) =>
      transformClaudeHomeTemplateContent(relativePath, content, params),
    overwrite: params.overwrite,
  });
}

function listTemplateFiles(params: {
  templateRoot: string;
  mapPath: (relativePath: string) => string | null;
  transformContent: (relativePath: string, content: string) => string;
  overwrite?: (relativePath: string) => boolean;
}): WorkspaceTemplateFile[] {
  const root = path.resolve(params.templateRoot ?? resolveUserWorkspaceTemplateRoot());
  if (!fs.existsSync(root)) {
    throw new Error(`User workspace template is missing: ${root}`);
  }

  const files: WorkspaceTemplateFile[] = [];
  const visit = (absoluteDir: string, relativeDir = '') => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .filter((entry) => entry.name !== '.DS_Store')
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = relativeDir
        ? path.posix.join(relativeDir, entry.name)
        : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const mappedPath = params.mapPath(relativePath);
      if (!mappedPath) continue;

      const content = params.transformContent(
        mappedPath,
        fs.readFileSync(absolutePath, 'utf8'),
      );
      files.push({
        path: mappedPath,
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
        overwrite: params.overwrite?.(mappedPath) ?? false,
      });
    }
  };

  visit(root);
  return files;
}

function mapWorkspaceTemplatePath(relativePath: string): string | null {
  if (relativePath === 'CLAUDE.md') return relativePath;
  if (relativePath.startsWith('.claude/')) return null;
  if (relativePath.startsWith('0-System/')) return null;
  return relativePath;
}

function mapClaudeHomeTemplatePath(relativePath: string): string | null {
  if (relativePath === 'CLAUDE.md') return 'CLAUDE.md';
  if (relativePath === '.claude/settings.local.json') return 'settings.local.json';
  if (relativePath === '0-System/about-me/BOOTSTRAP.md') return null;
  if (relativePath.startsWith('0-System/about-me/')) {
    return `about-me/${relativePath.slice('0-System/about-me/'.length)}`;
  }
  if (relativePath === '0-System/context.md') return 'context.md';
  if (relativePath === '0-System/status.md') return 'status.md';
  if (relativePath.startsWith('0-System/memory/')) {
    return `memory/${relativePath.slice('0-System/memory/'.length)}`;
  }
  return null;
}

function applyTemplateVariables(content: string, opts: TemplateTransformOptions): string {
  const ownerName = opts.ownerName ?? '{{OWNER_NAME}}';
  return content
    .replaceAll('{{ASSISTANT_NAME}}', opts.assistantName ?? '{{ASSISTANT_NAME}}')
    .replaceAll('{{OWNER_NAME}}', ownerName)
    .replaceAll('{{USERNAME}}', ownerName);
}

function transformProfilePaths(content: string): string {
  return content
    .replaceAll('0-System/about-me/', '~/.claude/about-me/')
    .replaceAll('0-System/about-me', '~/.claude/about-me')
    .replaceAll('0-System/memory/', '~/.claude/memory/')
    .replaceAll('0-System/memory', '~/.claude/memory')
    .replaceAll('0-System/context.md', '~/.claude/context.md')
    .replaceAll('0-System/status.md', '~/.claude/status.md')
    .replaceAll('5-Archive/bootstrap/', '~/.claude/archive/bootstrap/')
    .replaceAll('5-Archive/bootstrap', '~/.claude/archive/bootstrap');
}

function ensureBootstrapSentinel(content: string, include: boolean | undefined): string {
  const withoutSentinel = content
    .split('\n')
    .filter((line) => line.trim() !== BOOTSTRAP_SENTINEL)
    .join('\n')
    .replace(/^\n+/, '');
  if (!include) return withoutSentinel;
  return `${BOOTSTRAP_SENTINEL}\n\n${withoutSentinel}`;
}

function transformWorkspaceTemplateContent(
  relativePath: string,
  content: string,
  opts: TemplateTransformOptions,
): string {
  if (relativePath !== 'CLAUDE.md') {
    return applyTemplateVariables(content, opts);
  }
  const lines = [
    ...(opts.includeBootstrapSentinel ? [BOOTSTRAP_SENTINEL, ''] : []),
    '# Workspace',
    '',
    '这里是当前工作区，只保存这个工作区相关的项目文件、产出和临时材料。',
    '',
    '用户级记忆、身份、长期偏好、内置 skills 与 Claude 配置在 `~/.claude/`。需要了解你是谁、用户是谁或最近上下文时，先读取 `~/.claude/CLAUDE.md` 与 `~/.claude/about-me/`。',
    '',
    '不要把长期记忆或身份文件写进当前 workspace；这里只记录项目本身需要留下的内容。',
  ];
  return applyTemplateVariables(lines.join('\n'), opts);
}

function transformClaudeHomeTemplateContent(
  relativePath: string,
  content: string,
  opts: TemplateTransformOptions,
): string {
  const deterministic = buildDeterministicClaudeHomeFile(relativePath, opts);
  if (deterministic !== null) {
    return deterministic;
  }
  const withVariables = applyTemplateVariables(transformProfilePaths(content), opts);
  if (relativePath === 'CLAUDE.md') {
    return ensureBootstrapSentinel(withVariables, opts.includeBootstrapSentinel);
  }
  return withVariables;
}

function valueOrPlaceholder(value: string | undefined, placeholder: string): string {
  const trimmed = value?.trim();
  return trimmed || placeholder;
}

function buildDeterministicClaudeHomeFile(
  relativePath: string,
  opts: TemplateTransformOptions,
): string | null {
  const assistantName = valueOrPlaceholder(opts.assistantName, '{{ASSISTANT_NAME}}');
  const ownerName = valueOrPlaceholder(opts.ownerName, '{{OWNER_NAME}}');

  if (relativePath === 'CLAUDE.md') {
    return [
      '# 道友 AI 用户级上下文',
      '',
      '这里是用户级 Claude home 入口，记录长期身份、偏好、记忆和工具环境。',
      '',
      '## 读取顺序',
      '',
      '1. 先读 `~/.claude/about-me/README.md`，了解这组长期上下文文件的职责。',
      '2. 再读 `~/.claude/about-me/IDENTITY.md`，确认助手名称和产品定位。',
      '3. 继续读 `~/.claude/about-me/USER.md`，确认用户称呼与协作边界。',
      '4. 需要长期偏好时读取 `~/.claude/about-me/MEMORY.md`。',
      '5. 当前阶段信息在 `~/.claude/status.md` 和 `~/.claude/context.md`。',
      '',
      '## 写入原则',
      '',
      '- 长期身份、用户偏好和稳定记忆写入 `~/.claude/about-me/`。',
      '- 每日原始记录写入 `~/.claude/memory/YYYY-MM-DD.md`。',
      '- 当前 workspace 只保存项目文件和项目说明，不承载长期身份或记忆。',
      '- 如遇到历史 workspace 下的身份目录，不要迁移；以 `~/.claude/about-me/` 为准。',
    ].join('\n');
  }

  if (relativePath === 'about-me/README.md') {
    return [
      '# about-me',
      '',
      '`~/.claude/about-me/` 是道友 AI 的用户级长期上下文目录。',
      '',
      '## 文件职责',
      '',
      '- `IDENTITY.md`：助手名称、产品定位和默认协作风格。',
      '- `USER.md`：用户称呼、时区和稳定协作偏好。',
      '- `MEMORY.md`：长期偏好、稳定结论和可复用判断。',
      '- `SOUL.md`：通用工作原则和边界。',
      '- `TOOLS.md`：本地工具、环境和账号备注。',
      '- `HEARTBEAT.md`：主动检查与周期性任务约定。',
      '',
      '工作区相关文件留在 workspace；长期记忆留在这里。',
    ].join('\n');
  }

  if (relativePath === 'about-me/IDENTITY.md') {
    return [
      '# IDENTITY.md',
      '',
      '- 名称：' + assistantName,
      '- 产品：道友 AI',
      '- 公司：念头通达',
      '- 定位：面向个人工作的生产力 AI 助手。',
      '- 默认风格：中性、清晰、可靠，先结论后细节。',
      '',
      '## 协作原则',
      '',
      '- 先理解任务目标，再选择最小必要行动。',
      '- 能通过现有上下文判断时，少打扰用户。',
      '- 涉及外部发送、付款、删除、部署等高影响操作时先确认。',
      '- 不使用旧助手口吻或身份设定。',
    ].join('\n');
  }

  if (relativePath === 'about-me/USER.md') {
    return [
      '# USER.md',
      '',
      '- 称呼方式：' + ownerName,
      '- 时区：Asia/Shanghai',
      '- 默认协作偏好：直接、具体、可执行。',
      '',
      '## 备注',
      '',
      '- 新用户初始化已完成。',
      '- 后续稳定偏好写入 `~/.claude/about-me/MEMORY.md`。',
    ].join('\n');
  }

  if (relativePath === 'about-me/MEMORY.md') {
    return [
      '# MEMORY.md',
      '',
      '## 长期偏好',
      '',
      '- 助手名称：' + assistantName,
      '- 对用户称呼：' + ownerName,
      '- 产品口径：道友 AI，由念头通达提供。',
      '- 回复风格：先结论，后细节，保持简洁和可执行。',
      '',
      '## 长期记忆',
      '',
      '- 新用户初始化已完成，长期身份和偏好以 `~/.claude/about-me/` 为准。',
      '',
      '## 关联记忆文件',
      '',
      '- 短期：`~/.claude/status.md`',
      '- 中期：`~/.claude/context.md`',
      '- 每日原始记录：`~/.claude/memory/YYYY-MM-DD.md`',
      '',
      '## 更新约定',
      '',
      '1. 当天新事实先记到 `~/.claude/memory/YYYY-MM-DD.md`。',
      '2. 稳定偏好和长期结论再提炼到本文件。',
      '3. 工作区只记录项目上下文，不迁移旧的 workspace 身份文件。',
    ].join('\n');
  }

  if (relativePath === 'about-me/SOUL.md') {
    return [
      '# SOUL.md',
      '',
      '## 工作原则',
      '',
      '- 以完成用户目标为先，少做表演式回应。',
      '- 先读已有上下文，再决定是否需要追问。',
      '- 对事实、限制和风险保持清楚表达。',
      '- 需要外部副作用时先确认授权。',
      '',
      '## 语气',
      '',
      '保持中性、可靠、生产力工具感。可以轻微使用“问道”“念头通达”等产品表达，但不过度包装。',
    ].join('\n');
  }

  return null;
}

export function buildWorkspaceTemplateSeedCommand(params: {
  workspaceDir: string;
  files: WorkspaceTemplateFile[];
}): string {
  return buildTemplateSeedCommand({
    marker: 'MYCC_WORKSPACE_TEMPLATE_SEED',
    rootVarName: 'workspaceDir',
    rootDir: params.workspaceDir,
    files: params.files,
  });
}

export function buildClaudeHomeTemplateSeedCommand(params: {
  claudeHomeDir: string;
  files: WorkspaceTemplateFile[];
}): string {
  return buildTemplateSeedCommand({
    marker: 'MYCC_CLAUDE_HOME_TEMPLATE_SEED',
    rootVarName: 'claudeHomeDir',
    rootDir: params.claudeHomeDir,
    files: params.files,
    ensureDirs: ['about-me', 'memory', 'archive/bootstrap', 'projects'],
  });
}

function buildTemplateSeedCommand(params: {
  marker: string;
  rootVarName: string;
  rootDir: string;
  files: WorkspaceTemplateFile[];
  ensureDirs?: string[];
}): string {
  const script = [
    'const fs=require("fs");',
    'const path=require("path");',
    `const ${params.rootVarName}=${JSON.stringify(params.rootDir)};`,
    `const files=${JSON.stringify(params.files)};`,
    `const ensureDirs=${JSON.stringify(params.ensureDirs ?? [])};`,
    `const root=path.resolve(${params.rootVarName});`,
    'const inside=(target)=>target===root||target.startsWith(root+path.sep);',
    'fs.mkdirSync(root,{recursive:true});',
    'for(const file of files){',
    '  const rel=String(file.path||"").replace(/^\\/+/, "");',
    '  const target=path.resolve(root,rel);',
    '  if(!inside(target)) throw new Error(`path-outside-workspace:${rel}`);',
    '  fs.mkdirSync(path.dirname(target),{recursive:true});',
    '  if(!fs.existsSync(target)||file.overwrite){',
    '    fs.writeFileSync(target,Buffer.from(file.contentBase64,"base64").toString("utf8"));',
    '  }',
    '}',
    'for(const rel of ensureDirs){',
    '  const target=path.resolve(root,rel);',
    '  if(!inside(target)) throw new Error(`path-outside-template-root:${rel}`);',
    '  fs.mkdirSync(target,{recursive:true});',
    '}',
    'process.stdout.write("seeded");',
  ].join('\n');

  return `node <<'${params.marker}'\n${script}\n${params.marker}`;
}
