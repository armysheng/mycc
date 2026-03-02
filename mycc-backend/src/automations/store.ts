import { randomUUID } from 'node:crypto';
import { escapeShellArg } from '../utils/validation.js';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import type {
  AutomationDocument,
  AutomationListResult,
  AutomationRecord,
  AutomationScheduleType,
  AutomationView,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './types.js';

type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;

interface LegacyTask {
  time: string;
  name: string;
  skill: string;
  description: string;
}

interface ParsedLegacyTasks {
  tasks: LegacyTask[];
  invalidRows: string[];
}

interface BuiltinTemplate {
  name: string;
  cron: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

const DAILY_RE = /^\d{1,2}:\d{2}$/;
const WEEKLY_RE = /^周[一二三四五六日]\s*\d{1,2}:\d{2}$/;
const ONCE_RE = /^\d{4}-\d{2}-\d{2}(?:\s+|T)\d{1,2}:\d{2}$/;
const INTERVAL_RE = /^每\d+(分钟|m|小时|h)$/;
const CRON_5_RE = /^([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)$/;

function detectScheduleType(time: string): AutomationScheduleType {
  if (INTERVAL_RE.test(time)) return 'interval';
  if (WEEKLY_RE.test(time)) return 'weekly';
  if (ONCE_RE.test(time)) return 'once';
  if (DAILY_RE.test(time)) return 'daily';
  return 'cron';
}

function toScheduleText(time: string): string {
  if (DAILY_RE.test(time)) return `每天 ${time}`;
  if (WEEKLY_RE.test(time)) return `每${time}`;
  const intervalMatch = time.match(/^每(\d+)(分钟|m|小时|h)$/);
  if (intervalMatch) {
    const unit = intervalMatch[2] === 'm' ? '分钟' : intervalMatch[2] === 'h' ? '小时' : intervalMatch[2];
    return `每 ${intervalMatch[1]} ${unit}`;
  }
  return time;
}

function toSafeCellText(input: string): string {
  return input.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function normalizeSkill(skill: string): string {
  const trimmed = skill.trim();
  if (!trimmed || trimmed === '-') return '';
  return trimmed;
}

function toDisplaySkill(skill?: string): string {
  return normalizeSkill(skill || '') || '-';
}

function hasSkill(skill?: string): boolean {
  return Boolean(normalizeSkill(skill || ''));
}

function normalizeCron(cron?: string): string {
  return (cron || '').trim();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'automation';
}

function createAutomationId(name: string): string {
  const short = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${slugify(name)}-${short}`;
}

function toView(record: AutomationRecord): AutomationView {
  const cron = normalizeCron(record.trigger.cron);
  return {
    ...record,
    scheduleText: record.trigger.type === 'cron' ? toScheduleText(cron) : '手动触发',
    type: record.trigger.type === 'cron' ? detectScheduleType(cron) : 'cron',
  };
}

function ensureString(input: unknown, fallback = ''): string {
  return typeof input === 'string' ? input : fallback;
}

function ensureBoolean(input: unknown, fallback = true): boolean {
  return typeof input === 'boolean' ? input : fallback;
}

function normalizeExecutionType(rawType: unknown, skill?: string): 'prompt' | 'skill' {
  const type = ensureString(rawType).trim();
  if (type === 'prompt') return 'prompt';
  if (type === 'skill') return hasSkill(skill) ? 'skill' : 'prompt';
  return hasSkill(skill) ? 'skill' : 'prompt';
}

function normalizeRecord(input: unknown, index: number): AutomationRecord {
  const row = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const now = new Date().toISOString();

  const trigger = (row.trigger && typeof row.trigger === 'object')
    ? row.trigger as Record<string, unknown>
    : {};
  const execution = (row.execution && typeof row.execution === 'object')
    ? row.execution as Record<string, unknown>
    : {};
  const delivery = (row.delivery && typeof row.delivery === 'object')
    ? row.delivery as Record<string, unknown>
    : {};

  const enabled = ensureBoolean(row.enabled, true);
  const statusRaw = ensureString(row.status, enabled ? 'healthy' : 'paused');
  const status = (statusRaw === 'healthy' || statusRaw === 'paused' || statusRaw === 'error')
    ? statusRaw
    : (enabled ? 'healthy' : 'paused');
  const triggerTypeRaw = ensureString(trigger.type, 'cron');
  const triggerType = (triggerTypeRaw === 'cron' || triggerTypeRaw === 'manual') ? triggerTypeRaw : 'cron';
  const executionSkill = normalizeSkill(ensureString(execution.skill));
  const executionType = normalizeExecutionType(execution.type, executionSkill);
  const lastRunStatusRaw = ensureString(execution.lastRunStatus);
  const lastRunStatus = (lastRunStatusRaw === 'success' || lastRunStatusRaw === 'failed') ? lastRunStatusRaw : null;
  const normalizedExecutionSkill = executionType === 'skill' ? executionSkill : '';

  return {
    id: ensureString(row.id) || `restored-${index + 1}`,
    name: ensureString(row.name) || `未命名任务 ${index + 1}`,
    description: ensureString(row.description),
    status,
    enabled,
    trigger: {
      type: triggerType,
      cron: normalizeCron(ensureString(trigger.cron)),
      timezone: ensureString(trigger.timezone, 'Asia/Shanghai'),
    },
    execution: {
      type: executionType,
      skill: normalizedExecutionSkill || undefined,
      prompt: ensureString(execution.prompt),
      runCount: Number.isFinite(execution.runCount) ? Number(execution.runCount) : 0,
      lastRunAt: ensureString(execution.lastRunAt) || null,
      lastRunStatus,
      lastError: ensureString(execution.lastError) || null,
    },
    delivery: {
      type: ensureString(delivery.type, 'inbox') === 'inbox' ? 'inbox' : 'inbox',
      enabled: ensureBoolean(delivery.enabled, true),
    },
    createdAt: ensureString(row.createdAt) || now,
    updatedAt: ensureString(row.updatedAt) || now,
  };
}

const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: '每日简报',
    cron: '09:00',
    description: '每天自动生成工作简报',
    prompt: '请总结昨天完成项、今天计划和风险提醒。',
    enabled: true,
  },
  {
    name: '每周复盘',
    cron: '周五 18:30',
    description: '每周五生成本周复盘摘要',
    prompt: '请回顾本周目标达成情况，并给出下周建议。',
    enabled: false,
  },
  {
    name: '系统健康巡检',
    cron: '每2小时',
    description: '巡检核心链路并输出状态',
    prompt: '执行健康检查并输出异常项、影响范围和建议动作。',
    enabled: false,
  },
];

function parseAutomationDocument(content: string): AutomationRecord[] {
  if (!content.trim()) return [];
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => normalizeRecord(item, index));
  }
  if (parsed && typeof parsed === 'object') {
    const doc = parsed as Partial<AutomationDocument> & { automations?: unknown };
    if (Array.isArray(doc.automations)) {
      return doc.automations.map((item, index) => normalizeRecord(item, index));
    }
  }
  return [];
}

export function parseTasksMd(content: string): LegacyTask[] {
  return parseTasksMdDetailed(content).tasks;
}

function looksLikeTaskTime(time: string): boolean {
  const normalized = time.trim();
  const relaxedInterval = normalized.replace(/\s+/g, '');
  return (
    DAILY_RE.test(normalized) ||
    WEEKLY_RE.test(normalized) ||
    ONCE_RE.test(normalized) ||
    INTERVAL_RE.test(relaxedInterval) ||
    CRON_5_RE.test(normalized)
  );
}

function parseTasksMdDetailed(content: string): ParsedLegacyTasks {
  const tasks: LegacyTask[] = [];
  const invalidRows: string[] = [];
  const lines = content.split('\n');
  const hasTaskSectionHeading = lines.some((line) => {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (!headingMatch) return false;
    const title = headingMatch[1].trim();
    return ['每日任务', '间隔任务', '每周任务', '一次性任务'].includes(title);
  });
  let inTaskSection = false;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      inTaskSection = ['每日任务', '间隔任务', '每周任务', '一次性任务'].includes(title);
      continue;
    }

    if (hasTaskSectionHeading && !inTaskSection) continue;
    if (!line.startsWith('|')) continue;
    if (line.includes('时间') || line.includes('日期时间') || line.includes('---')) continue;

    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;

    const [time, name, skill = '-', description = ''] = cells;
    if (!time && !name) continue;
    if (!looksLikeTaskTime(time)) {
      invalidRows.push(line.trim());
      continue;
    }

    tasks.push({
      time,
      name,
      skill: normalizeSkill(skill),
      description,
    });
  }

  return { tasks, invalidRows };
}

function legacyTaskToRecord(task: LegacyTask, index: number): AutomationRecord {
  const now = new Date().toISOString();
  const skill = normalizeSkill(task.skill);
  const executionType = skill ? 'skill' : 'prompt';
  return {
    id: `legacy-${slugify(task.name || 'task')}-${index + 1}`,
    name: task.name || `历史任务 ${index + 1}`,
    description: task.description || '',
    status: 'healthy',
    enabled: true,
    trigger: {
      type: 'cron',
      cron: task.time,
      timezone: 'Asia/Shanghai',
    },
    execution: {
      type: executionType,
      skill: executionType === 'skill' ? skill : undefined,
      prompt: task.description || task.name,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    },
    delivery: {
      type: 'inbox',
      enabled: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildBuiltinRecords(): AutomationRecord[] {
  const now = new Date().toISOString();
  return BUILTIN_TEMPLATES.map((template, index) => normalizeRecord({
    id: createAutomationId(template.name),
    name: template.name,
    description: template.description,
    status: template.enabled ? 'healthy' : 'paused',
    enabled: template.enabled,
    trigger: {
      type: 'cron',
      cron: template.cron,
      timezone: 'Asia/Shanghai',
    },
    execution: {
      type: 'prompt',
      prompt: template.prompt,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
    },
    delivery: {
      type: 'inbox',
      enabled: true,
    },
    createdAt: now,
    updatedAt: now,
  }, index));
}

function tasksRows(records: AutomationRecord[]): { daily: string[]; weekly: string[]; interval: string[]; once: string[] } {
  const rows = {
    daily: [] as string[],
    weekly: [] as string[],
    interval: [] as string[],
    once: [] as string[],
  };

  for (const record of records) {
    if (!record.enabled || record.trigger.type !== 'cron') continue;
    const cron = normalizeCron(record.trigger.cron);
    if (!cron) continue;

    const skill = toSafeCellText(toDisplaySkill(record.execution.skill));
    const desc = toSafeCellText(record.description || record.execution.prompt || '-');
    const name = toSafeCellText(record.name);
    const row = `| ${cron} | ${name} | ${skill} | ${desc} |`;
    const type = detectScheduleType(cron);

    if (type === 'daily') rows.daily.push(row);
    else if (type === 'weekly') rows.weekly.push(row);
    else if (type === 'once') rows.once.push(row);
    else rows.interval.push(row);
  }

  return rows;
}

export function renderTasksMd(records: AutomationRecord[]): string {
  const rows = tasksRows(records);
  const section = (title: string, header: string, list: string[]) => {
    const body = list.length ? list.join('\n') : '';
    return `## ${title}\n\n${header}\n${body}`;
  };

  return [
    '# 定时任务配置（由 automations.json 自动生成）',
    '',
    '> 注意：请勿手动编辑本文件；变更会在自动化 API 写入时被覆盖。',
    '',
    section('每日任务', '| 时间 | 任务 | Skill | 说明 |\n|------|------|-------|------|', rows.daily),
    '',
    section('间隔任务', '| 时间 | 任务 | Skill | 说明 |\n|------|------|-------|------|', rows.interval),
    '',
    section('每周任务', '| 时间 | 任务 | Skill | 说明 |\n|------|------|-------|------|', rows.weekly),
    '',
    section('一次性任务', '| 日期时间 | 任务 | Skill | 说明 |\n|----------|------|-------|------|', rows.once),
    '',
  ].join('\n');
}

function runAsLinuxUserCommand(linuxUser: string, command: string): string {
  return `sudo -u ${escapeShellArg(linuxUser)} bash -lc ${escapeShellArg(command)}`;
}

export class AutomationStoreError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AutomationStoreError';
  }
}

export class AutomationStore {
  private readonly schedulerDir: string;
  private readonly automationsPath: string;
  private readonly tasksPath: string;
  private readonly tasksBackupPath: string;

  constructor(
    private readonly linuxUser: string,
    private readonly run: ExecFn,
    private readonly runAsUser: ExecFn,
  ) {
    this.schedulerDir = `/home/${linuxUser}/workspace/.claude/skills/scheduler`;
    this.automationsPath = `${this.schedulerDir}/automations.json`;
    this.tasksPath = `${this.schedulerDir}/tasks.md`;
    this.tasksBackupPath = `${this.schedulerDir}/tasks.legacy.backup.md`;
  }

  static buildUserCommand = runAsLinuxUserCommand;

  private async readFile(path: string): Promise<string> {
    const result = await this.runAsUser(`cat ${escapeShellArg(path)} 2>/dev/null || true`);
    if (result.exitCode !== 0) {
      throw new AutomationStoreError(500, result.stderr || `读取文件失败: ${path}`);
    }
    return result.stdout || '';
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const contentB64 = Buffer.from(content, 'utf8').toString('base64');
    const script = `
TARGET=${escapeShellArg(path)}
CONTENT_B64=${escapeShellArg(contentB64)}
export TARGET CONTENT_B64
mkdir -p "$(dirname "$TARGET")"
node <<'NODE'
const fs = require('fs');
const target = process.env.TARGET;
const content = Buffer.from(process.env.CONTENT_B64 || '', 'base64').toString('utf8');
fs.writeFileSync(target, content, 'utf8');
NODE
`;
    const result = await this.runAsUser(script);
    if (result.exitCode !== 0) {
      throw new AutomationStoreError(500, result.stderr || `写入文件失败: ${path}`);
    }
  }

  private async loadRecords(): Promise<{ records: AutomationRecord[]; migratedFromTasks: boolean }> {
    const raw = await this.readFile(this.automationsPath);
    if (raw.trim()) {
      try {
        return {
          records: parseAutomationDocument(raw),
          migratedFromTasks: false,
        };
      } catch (error) {
        throw new AutomationStoreError(500, `automations.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const tasksContent = await this.readFile(this.tasksPath);
    const parsedLegacy = tasksContent.trim()
      ? parseTasksMdDetailed(tasksContent)
      : { tasks: [], invalidRows: [] };
    const legacyTasks = parsedLegacy.tasks;

    if (!tasksContent.trim()) {
      const seeded = buildBuiltinRecords();
      await this.persistRecords(seeded);
      return {
        records: seeded,
        migratedFromTasks: false,
      };
    }

    if (parsedLegacy.invalidRows.length > 0) {
      const sample = parsedLegacy.invalidRows.slice(0, 2).join(' ; ');
      throw new AutomationStoreError(500, `legacy tasks.md 存在无法识别的任务时间行，已阻止自动迁移以避免数据丢失: ${sample}`);
    }

    if (tasksContent.trim() && legacyTasks.length === 0) {
      throw new AutomationStoreError(500, 'legacy tasks.md 存在但无法解析，已阻止自动迁移以避免数据丢失');
    }

    if (tasksContent.trim()) {
      try {
        await this.writeFile(this.tasksBackupPath, tasksContent);
      } catch (error) {
        console.warn('[automations] legacy tasks backup failed:', error);
      }
    }

    const migrated = legacyTasks.map((task, index) => legacyTaskToRecord(task, index));

    await this.persistRecords(migrated);
    return {
      records: migrated,
      migratedFromTasks: migrated.length > 0,
    };
  }

  private async persistRecords(records: AutomationRecord[]): Promise<void> {
    const now = new Date().toISOString();
    const normalized = records.map((record, index) => normalizeRecord({
      ...record,
      updatedAt: now,
    }, index));
    const doc: AutomationDocument = {
      version: 1,
      updatedAt: now,
      automations: normalized,
    };
    await this.writeFile(this.automationsPath, `${JSON.stringify(doc, null, 2)}\n`);
    await this.writeFile(this.tasksPath, `${renderTasksMd(normalized)}\n`);
  }

  async listAutomations(): Promise<AutomationListResult> {
    const { records, migratedFromTasks } = await this.loadRecords();
    const automations = records
      .map((record) => toView(record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return {
      automations,
      total: automations.length,
      migratedFromTasks,
    };
  }

  async createAutomation(input: CreateAutomationInput): Promise<AutomationView> {
    const triggerCron = normalizeCron(input.trigger.cron);
    if (input.trigger.type === 'cron' && !triggerCron) {
      throw new AutomationStoreError(400, 'cron 触发任务必须提供 trigger.cron');
    }

    const { records } = await this.loadRecords();
    const now = new Date().toISOString();
    const enabled = input.enabled ?? true;
    const inputSkill = normalizeSkill(input.execution.skill || '');
    const requestedType = input.execution.type || (hasSkill(inputSkill) ? 'skill' : 'prompt');
    const executionType = requestedType === 'skill' && hasSkill(inputSkill) ? 'skill' : 'prompt';
    const record: AutomationRecord = normalizeRecord({
      id: createAutomationId(input.name),
      name: input.name,
      description: input.description || '',
      status: input.status || (enabled ? 'healthy' : 'paused'),
      enabled,
      trigger: {
        type: input.trigger.type,
        cron: triggerCron,
        timezone: input.trigger.timezone || 'Asia/Shanghai',
      },
      execution: {
        type: executionType,
        skill: executionType === 'skill' ? inputSkill : undefined,
        prompt: input.execution.prompt || '',
        runCount: 0,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      },
      delivery: {
        type: 'inbox',
        enabled: input.delivery?.enabled ?? true,
      },
      createdAt: now,
      updatedAt: now,
    }, records.length);

    records.push(record);
    await this.persistRecords(records);
    return toView(record);
  }

  async updateAutomation(id: string, patch: UpdateAutomationInput): Promise<AutomationView> {
    const { records } = await this.loadRecords();
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new AutomationStoreError(404, '自动化任务不存在');
    }
    const current = records[index];
    const enabled = patch.enabled ?? current.enabled;
    const nextTriggerType = patch.trigger?.type ?? current.trigger.type;
    const nextTriggerCron = normalizeCron(patch.trigger?.cron ?? current.trigger.cron);
    if (nextTriggerType === 'cron' && !nextTriggerCron) {
      throw new AutomationStoreError(400, 'cron 触发任务的 trigger.cron 不能为空');
    }

    const nextSkill = patch.execution?.skill !== undefined
      ? normalizeSkill(patch.execution.skill || '')
      : normalizeSkill(current.execution.skill || '');
    const nextTypeCandidate = patch.execution?.type
      ?? (patch.execution?.skill !== undefined ? (hasSkill(nextSkill) ? 'skill' : 'prompt') : current.execution.type);
    const nextExecutionType = nextTypeCandidate === 'skill' && hasSkill(nextSkill) ? 'skill' : 'prompt';

    const next: AutomationRecord = normalizeRecord({
      ...current,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      enabled,
      status: patch.status ?? (enabled ? (current.status === 'paused' ? 'healthy' : current.status) : 'paused'),
      trigger: {
        ...current.trigger,
        ...patch.trigger,
        cron: nextTriggerCron,
      },
      execution: {
        ...current.execution,
        ...patch.execution,
        type: nextExecutionType,
        skill: nextExecutionType === 'skill' ? nextSkill : undefined,
      },
      delivery: {
        ...current.delivery,
        ...patch.delivery,
      },
      updatedAt: new Date().toISOString(),
    }, index);

    records[index] = next;
    await this.persistRecords(records);
    return toView(next);
  }

  async setEnabled(id: string, enabled: boolean): Promise<AutomationView> {
    return this.updateAutomation(id, {
      enabled,
      status: enabled ? 'healthy' : 'paused',
    });
  }

  async deleteAutomation(id: string): Promise<void> {
    const { records } = await this.loadRecords();
    const filtered = records.filter((item) => item.id !== id);
    if (filtered.length === records.length) {
      throw new AutomationStoreError(404, '自动化任务不存在');
    }
    await this.persistRecords(filtered);
  }

  async runOnce(id: string): Promise<{
    automation: AutomationView;
    run: { executedAt: string; status: 'success' };
  }> {
    const { records } = await this.loadRecords();
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new AutomationStoreError(404, '自动化任务不存在');
    }
    const current = records[index];
    const executedAt = new Date().toISOString();
    const runCount = current.execution.runCount + 1;

    let runStatus: 'success' | 'failed' = 'success';
    let runError: string | null = null;
    try {
      await this.executeAutomation(current);
    } catch (error) {
      runStatus = 'failed';
      runError = error instanceof Error ? error.message : String(error);
    }

    const next: AutomationRecord = normalizeRecord({
      ...current,
      execution: {
        ...current.execution,
        runCount,
        lastRunAt: executedAt,
        lastRunStatus: runStatus,
        lastError: runError,
      },
      updatedAt: executedAt,
    }, index);

    records[index] = next;
    await this.persistRecords(records);
    console.info(`[automations] run once user=${this.linuxUser} id=${next.id} skill=${toDisplaySkill(next.execution.skill)} status=${runStatus}`);

    if (runStatus === 'failed') {
      throw new AutomationStoreError(500, `立即运行失败: ${runError || '未知错误'}`);
    }

    return {
      automation: toView(next),
      run: {
        executedAt,
        status: 'success',
      },
    };
  }

  private buildRunMessage(record: AutomationRecord): string {
    const skillRaw = (record.execution.skill || '').trim();
    const skillPrefix = record.execution.type === 'skill' && skillRaw && skillRaw !== '-'
      ? (skillRaw.startsWith('/') ? skillRaw : `/${skillRaw}`)
      : '';
    const content = (record.execution.prompt || record.description || record.name || '').trim();
    if (!content) {
      throw new AutomationStoreError(400, '执行内容为空，无法立即运行');
    }
    return skillPrefix ? `${skillPrefix} ${content}`.trim() : content;
  }

  private async executeAutomation(record: AutomationRecord): Promise<void> {
    const adapter = new RemoteClaudeAdapter();
    const message = this.buildRunMessage(record);
    const cwd = `/home/${this.linuxUser}/workspace`;

    let runtimeError: string | null = null;
    for await (const event of adapter.chat({
      message,
      cwd,
      linuxUser: this.linuxUser,
    })) {
      if (event.type === 'error') {
        runtimeError = typeof event.error === 'string' ? event.error : '执行失败';
        break;
      }

      if (event.type === 'result' && event.is_error === true) {
        runtimeError = typeof event.result === 'string'
          ? event.result
          : (typeof event.error === 'string' ? event.error : '执行失败');
        break;
      }
    }

    if (runtimeError) {
      throw new Error(runtimeError);
    }
  }
}
