import { describe, expect, it } from 'vitest';
import { parseTasksMd, renderTasksMd } from './store.js';
import type { AutomationRecord } from './types.js';

describe('automation store helpers', () => {
  it('parses legacy tasks.md rows into tasks', () => {
    const md = `
| 时间 | 任务 | Skill | 说明 |
|------|------|-------|------|
| 09:00 | 每日简报 | /tell-me | 总结昨日进展 |
| 周一 18:30 | 周会提醒 | /scheduler | 准备周会材料 |
| 每2小时 | 健康巡检 | /mycc-regression | 采集健康指标 |
| 2026-03-02 10:00 | 临时提醒 | /tell-me | 一次性提醒 |
`;

    const rows = parseTasksMd(md);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      time: '09:00',
      name: '每日简报',
      skill: '/tell-me',
      description: '总结昨日进展',
    });
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
        name: '手动任务',
        description: '手动触发',
        status: 'healthy',
        enabled: true,
        trigger: { type: 'manual', timezone: 'Asia/Shanghai' },
        execution: {
          type: 'skill',
          skill: '/scheduler',
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
    expect(md).not.toContain('暂停任务');
    expect(md).not.toContain('手动任务');
  });
});
