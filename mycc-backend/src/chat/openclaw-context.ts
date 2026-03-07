/**
 * OpenClaw-inspired workspace context injection.
 * Source reference:
 * - src/agents/pi-embedded-helpers/bootstrap.ts
 * - src/agents/system-prompt.ts
 * - src/agents/workspace.ts
 */

export const OPENCLAW_BOOTSTRAP_MAX_CHARS = 20_000;
export const OPENCLAW_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;

export type WorkspaceBootstrapFileName =
  | 'README.md'
  | 'SOUL.md'
  | 'TOOLS.md'
  | 'IDENTITY.md'
  | 'USER.md'
  | 'HEARTBEAT.md'
  | 'BOOTSTRAP.md'
  | 'MEMORY.md'
  | 'memory.md';

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

export type EmbeddedContextFile = {
  path: string;
  content: string;
};

function trimBootstrapContent(content: string, fileName: string, maxChars: number): string {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
  const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);
  const marker = [
    '',
    `[...truncated, read ${fileName} for full content...]`,
    `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`,
    '',
  ].join('\n');
  return [head, marker, tail].join('\n');
}

function clampToBudget(content: string, budget: number): string {
  if (budget <= 0) return '';
  if (content.length <= budget) return content;
  if (budget <= 3) return content.slice(0, budget);
  return `${content.slice(0, budget - 1)}…`;
}

export function buildBootstrapContextFiles(
  files: WorkspaceBootstrapFile[],
  opts?: { maxChars?: number; totalMaxChars?: number },
): EmbeddedContextFile[] {
  const maxChars = opts?.maxChars ?? OPENCLAW_BOOTSTRAP_MAX_CHARS;
  const totalMaxChars = opts?.totalMaxChars ?? OPENCLAW_BOOTSTRAP_TOTAL_MAX_CHARS;
  let remainingTotalChars = Math.max(1, Math.floor(totalMaxChars));
  const result: EmbeddedContextFile[] = [];

  for (const file of files) {
    if (remainingTotalChars <= 0) break;
    if (!file.path?.trim()) continue;

    if (file.missing) {
      const missingText = `[MISSING] Expected at: ${file.path}`;
      const cappedMissingText = clampToBudget(missingText, remainingTotalChars);
      if (!cappedMissingText) break;
      remainingTotalChars = Math.max(0, remainingTotalChars - cappedMissingText.length);
      result.push({ path: file.path, content: cappedMissingText });
      continue;
    }

    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) break;
    const fileMaxChars = Math.max(1, Math.min(maxChars, remainingTotalChars));
    const trimmed = trimBootstrapContent(file.content ?? '', file.name, fileMaxChars);
    const contentWithinBudget = clampToBudget(trimmed, remainingTotalChars);
    if (!contentWithinBudget) continue;
    remainingTotalChars = Math.max(0, remainingTotalChars - contentWithinBudget.length);
    result.push({ path: file.path, content: contentWithinBudget });
  }

  return result;
}

export function buildProjectContextPrompt(contextFiles: EmbeddedContextFile[]): string {
  if (contextFiles.length === 0) return '';
  const hasSoulFile = contextFiles.some((file) => {
    const normalizedPath = file.path.trim().replace(/\\/g, '/');
    const baseName = normalizedPath.split('/').pop() ?? normalizedPath;
    return baseName.toLowerCase() === 'soul.md';
  });

  const lines: string[] = [
    '# Project Context',
    '',
    'The following project context files have been loaded:',
    'Identity consistency rule: `0-System/about-me/` is the single source of truth.',
    'If any legacy/global memory conflicts (for example `~/.claude/projects/.../memory/MEMORY.md`), follow `about-me` values and ignore conflicting aliases.',
  ];
  if (hasSoulFile) {
    lines.push(
      'If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.',
    );
  }
  lines.push('');
  for (const file of contextFiles) {
    lines.push(`## ${file.path}`, '', file.content, '');
  }
  return lines.join('\n');
}

export function injectProjectContextPrompt(message: string, projectContextPrompt: string): string {
  const context = projectContextPrompt.trim();
  if (!context) return message;
  return [
    context,
    '',
    '## User Request',
    message,
  ].join('\n');
}
