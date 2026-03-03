import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AutomationStore, parseTasksMd, renderTasksMd } from './store.js';
import type { AutomationRecord } from './types.js';

const noopExec = async () => ({ stdout: '', stderr: '', exitCode: 0 });

describe('automation store helpers', () => {
  it('parses legacy tasks.md rows into tasks', () => {
    const md = `
| 时间 | 任务 | Skill | 说明 |
|------|------|-------|------|
| 09:00 | 每日简报 | /tell-me | 总结昨日进展 |
| 周一 18:30 | 周会提醒 | /scheduler | 准备周会材料 |
| 周二18:40 | 无空格周任务 | /tell-me | 兼容旧格式 |
| 每2小时 | 健康巡检 | /mycc-regression | 采集健康指标 |
| 2026-03-02 10:00 | 临时提醒 | /tell-me | 一次性提醒 |
| 2026-03-03T10:00 | T分隔提醒 | /tell-me | 兼容旧格式 |
`;

    const rows = parseTasksMd(md);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      time: '09:00',
      name: '每日简报',
      skill: '/tell-me',
      description: '总结昨日进展',
    });
    expect(rows[5]).toEqual({
      time: '2026-03-03T10:00',
      name: 'T分隔提醒',
      skill: '/tell-me',
      description: '兼容旧格式',
    });
  });

  it('does not migrate guidance tables from tasks.md.example', () => {
    const samplePath = new URL('../../../.claude/skills/scheduler/tasks.md.example', import.meta.url);
    const md = readFileSync(samplePath, 'utf8');
    const rows = parseTasksMd(md);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.time)).toEqual([
      '23:40',
      '每2小时',
      '2026-02-01 10:00',
    ]);
    expect(rows.some((row) => ['类型', '每日', '每周', '一次性', '间隔'].includes(row.time))).toBe(false);
  });

  it('renders only enabled cron tasks back to tasks.md', () => {
    const records: AutomationRecord[] = [
      {
        id: 'a1',
        name: '日报',
        description: '生成日报',
        status: 'healthy',
        enabled: true,
        trigger: { type: 'cron', cron: '09:00', timezone: 'Asia/Shanghai' },
        execution: {
          type: 'skill',
          skill: '/tell-me',
          prompt: '日报',
          runCount: 0,
          lastRunAt: null,
          lastRunStatus: null,
          lastError: null,
        },
        delivery: { type: 'inbox', enabled: true },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'a2',
        name: '暂停任务',
        description: '不应出现在 tasks.md',
        status: 'paused',
        enabled: false,
        trigger: { type: 'cron', cron: '10:00', timezone: 'Asia/Shanghai' },
        execution: {
          type: 'skill',
          skill: '/tell-me',
          prompt: '',
          runCount: 0,
          lastRunAt: null,
          lastRunStatus: null,
          lastError: null,
        },
        delivery: { type: 'inbox', enabled: true },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'a3',
        name: '默认执行任务',
        description: '无 skill 也应落盘',
        status: 'healthy',
        enabled: true,
        trigger: { type: 'cron', cron: '11:00', timezone: 'Asia/Shanghai' },
        execution: {
          type: 'prompt',
          prompt: '',
          runCount: 0,
          lastRunAt: null,
          lastRunStatus: null,
          lastError: null,
        },
        delivery: { type: 'inbox', enabled: true },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ];

    const md = renderTasksMd(records);
    expect(md).toContain('| 09:00 | 日报 | /tell-me | 生成日报 |');
    expect(md).toContain('| 11:00 | 默认执行任务 | - | 无 skill 也应落盘 |');
    expect(md).not.toContain('暂停任务');
  });

  it('supports prompt execution create + run once', async () => {
    const store = new AutomationStore('tester', noopExec, noopExec);
    const persistedSnapshots: AutomationRecord[][] = [];

    vi.spyOn(store as any, 'loadRecords').mockResolvedValueOnce({
      records: [],
      migratedFromTasks: false,
    });
    vi.spyOn(store as any, 'persistRecords').mockImplementation(async (...args: unknown[]) => {
      persistedSnapshots.push(args[0] as AutomationRecord[]);
    });

    const created = await store.createAutomation({
      name: '提示词任务',
      description: '仅提示词执行',
      enabled: true,
      trigger: { type: 'cron', cron: '09:00', timezone: 'Asia/Shanghai' },
      execution: { type: 'prompt', prompt: '请输出日报' },
      delivery: { type: 'inbox', enabled: true },
    });

    expect(created.execution.type).toBe('prompt');
    expect(created.execution.skill).toBeUndefined();
    expect(persistedSnapshots).toHaveLength(1);
    const createdRecord = persistedSnapshots[0][0];

    vi.spyOn(store as any, 'loadRecords').mockResolvedValueOnce({
      records: [createdRecord],
      migratedFromTasks: false,
    });
    vi.spyOn(store as any, 'executeAutomation').mockResolvedValueOnce({
      inputTokens: 11,
      outputTokens: 22,
      model: 'claude-sonnet-4-6',
    });
    vi.spyOn(store as any, 'persistRecords').mockImplementation(async (...args: unknown[]) => {
      persistedSnapshots.push(args[0] as AutomationRecord[]);
    });

    const result = await store.runOnce(createdRecord.id);
    expect(result.run.status).toBe('success');
    expect(result.automation.execution.runCount).toBe(1);
    expect(result.automation.execution.lastRunStatus).toBe('success');
    expect(result.run.usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      model: 'claude-sonnet-4-6',
    });
  });

  it('blocks run once when quota is exhausted', async () => {
    const store = new AutomationStore('tester', noopExec, noopExec, {
      checkQuota: async () => ({ allowed: false, remaining: 0 }),
    });
    const record: AutomationRecord = {
      id: 'quota-1',
      name: '额度任务',
      description: '',
      status: 'healthy',
      enabled: true,
      trigger: { type: 'cron', cron: '09:00', timezone: 'Asia/Shanghai' },
      execution: {
        type: 'prompt',
        prompt: 'hello',
        runCount: 0,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      },
      delivery: { type: 'inbox', enabled: true },
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    vi.spyOn(store as any, 'loadRecords').mockResolvedValueOnce({
      records: [record],
      migratedFromTasks: false,
    });
    const executeSpy = vi.spyOn(store as any, 'executeAutomation');

    await expect(store.runOnce('quota-1')).rejects.toThrow('额度已用完');
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('records usage after successful run', async () => {
    const recordUsage = vi.fn();
    const store = new AutomationStore('tester', noopExec, noopExec, {
      checkQuota: async () => ({ allowed: true, remaining: 1000 }),
      recordUsage,
    });
    const record: AutomationRecord = {
      id: 'usage-1',
      name: '计费任务',
      description: '',
      status: 'healthy',
      enabled: true,
      trigger: { type: 'cron', cron: '09:00', timezone: 'Asia/Shanghai' },
      execution: {
        type: 'prompt',
        prompt: 'hello',
        runCount: 0,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      },
      delivery: { type: 'inbox', enabled: true },
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    vi.spyOn(store as any, 'loadRecords').mockResolvedValueOnce({
      records: [record],
      migratedFromTasks: false,
    });
    vi.spyOn(store as any, 'persistRecords').mockResolvedValue(undefined);
    vi.spyOn(store as any, 'executeAutomation').mockResolvedValueOnce({
      inputTokens: 4,
      outputTokens: 8,
      model: 'claude-sonnet-4-6',
    });

    await store.runOnce('usage-1');
    expect(recordUsage).toHaveBeenCalledWith({
      automationId: 'usage-1',
      inputTokens: 4,
      outputTokens: 8,
      model: 'claude-sonnet-4-6',
    });
  });

  it('keeps legacy skill run message compatible', () => {
    const store = new AutomationStore('tester', noopExec, noopExec);
    const record: AutomationRecord = {
      id: 'legacy-1',
      name: '兼容任务',
      description: '',
      status: 'healthy',
      enabled: true,
      trigger: { type: 'manual', timezone: 'Asia/Shanghai' },
      execution: {
        type: 'skill',
        skill: 'tell-me',
        prompt: '请给我一个摘要',
        runCount: 0,
        lastRunAt: null,
        lastRunStatus: null,
        lastError: null,
      },
      delivery: { type: 'inbox', enabled: true },
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    const message = (store as any).buildRunMessage(record);
    expect(message).toBe('/tell-me 请给我一个摘要');
  });

  it('seeds builtin templates on first empty initialization', async () => {
    const store = new AutomationStore('tester', noopExec, noopExec);
    let persisted: AutomationRecord[] = [];

    vi.spyOn(store as any, 'readFile')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    vi.spyOn(store as any, 'persistRecords').mockImplementation(async (...args: unknown[]) => {
      persisted = args[0] as AutomationRecord[];
    });

    const result = await store.listAutomations();
    expect(result.total).toBe(3);
    expect(result.migratedFromTasks).toBe(false);
    expect(persisted).toHaveLength(3);

    const enabledByName = Object.fromEntries(result.automations.map((item) => [item.name, item.enabled]));
    expect(enabledByName['每日简报']).toBe(true);
    expect(enabledByName['每周复盘']).toBe(false);
    expect(enabledByName['系统健康巡检']).toBe(false);
  });
});
