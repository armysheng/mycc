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
  const withVariables = applyTemplateVariables(transformProfilePaths(content), opts);
  if (relativePath === 'CLAUDE.md') {
    return ensureBootstrapSentinel(withVariables, opts.includeBootstrapSentinel);
  }
  return withVariables;
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
