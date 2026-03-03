import { describe, expect, it } from 'vitest';
import { hasExecutedInCurrentSlot, resolveScheduleSlotKey } from './scheduler.js';
import type { AutomationView } from './types.js';

function mockAutomation(params: {
  cron: string;
  timezone?: string;
  lastRunAt?: string | null;
}): AutomationView {
  return {
    id: 'a1',
    name: 'test',
    description: '',
    status: 'healthy',
    enabled: true,
    trigger: {
      type: 'cron',
      cron: params.cron,
      timezone: params.timezone || 'Asia/Shanghai',
    },
    execution: {
      type: 'prompt',
      prompt: 'hello',
      runCount: 1,
      lastRunAt: params.lastRunAt ?? null,
      lastRunStatus: 'success',
      lastError: null,
    },
    delivery: {
      type: 'inbox',
      enabled: true,
    },
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    scheduleText: '',
    type: 'daily',
  };
}

describe('automation scheduler matching', () => {
  it('matches daily schedule', () => {
    const now = new Date('2026-03-03T01:00:00.000Z'); // Asia/Shanghai 09:00
    const key = resolveScheduleSlotKey('09:00', 'Asia/Shanghai', now);
    expect(key).toBe('2026-03-03T09:00@Asia/Shanghai');
  });

  it('matches weekly schedule', () => {
    const now = new Date('2026-03-03T01:00:00.000Z'); // Tuesday
    const key = resolveScheduleSlotKey('周二 09:00', 'Asia/Shanghai', now);
    expect(key).toBe('2026-03-03T09:00@Asia/Shanghai');
  });

  it('matches once schedule', () => {
    const now = new Date('2026-03-03T01:00:00.000Z');
    const key = resolveScheduleSlotKey('2026-03-03 09:00', 'Asia/Shanghai', now);
    expect(key).toBe('2026-03-03T09:00@Asia/Shanghai');
  });

  it('matches interval schedule', () => {
    const due = new Date('2026-03-03T01:30:00.000Z'); // 09:30
    const miss = new Date('2026-03-03T01:31:00.000Z'); // 09:31
    expect(resolveScheduleSlotKey('每30分钟', 'Asia/Shanghai', due)).toBe('2026-03-03T09:30@Asia/Shanghai');
    expect(resolveScheduleSlotKey('每30分钟', 'Asia/Shanghai', miss)).toBeNull();
  });

  it('matches cron 5-field expressions', () => {
    const now = new Date('2026-03-03T01:00:00.000Z');
    expect(resolveScheduleSlotKey('0 9 * * *', 'Asia/Shanghai', now)).toBe('2026-03-03T09:00@Asia/Shanghai');
    expect(resolveScheduleSlotKey('*/15 9-18 * * 1-5', 'Asia/Shanghai', now)).toBe('2026-03-03T09:00@Asia/Shanghai');
  });

  it('detects already executed slot', () => {
    const now = new Date('2026-03-03T01:00:10.000Z');
    const executed = mockAutomation({
      cron: '09:00',
      lastRunAt: '2026-03-03T01:00:05.000Z',
    });
    const notExecuted = mockAutomation({
      cron: '09:00',
      lastRunAt: '2026-03-02T01:00:05.000Z',
    });

    expect(hasExecutedInCurrentSlot(executed, now)).toBe(true);
    expect(hasExecutedInCurrentSlot(notExecuted, now)).toBe(false);
  });
});
