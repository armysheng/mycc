import { getSSHPool } from '../ssh/pool.js';
import { listActiveUsers } from '../db/client.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';
import { AutomationStore } from './store.js';
import type { AutomationView } from './types.js';

const DAILY_RE = /^(\d{1,2}):(\d{2})$/;
const WEEKLY_RE = /^周([一二三四五六日])\s*(\d{1,2}):(\d{2})$/;
const ONCE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+|T)(\d{1,2}):(\d{2})$/;
const INTERVAL_RE = /^每(\d+)(分钟|m|小时|h)$/i;
const CRON_5_RE = /^([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)\s+([*0-9,\-/]+)$/;

const WEEKDAY_MAP: Record<string, number> = {
  '周日': 0,
  '周一': 1,
  '周二': 2,
  '周三': 3,
  '周四': 4,
  '周五': 5,
  '周六': 6,
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function parseIntSafe(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : NaN;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayRaw = byType.weekday || '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekday = weekdayMap[weekdayRaw];
  if (weekday === undefined) {
    throw new Error(`无法解析 weekday: ${weekdayRaw}`);
  }

  return {
    year: parseIntSafe(byType.year || ''),
    month: parseIntSafe(byType.month || ''),
    day: parseIntSafe(byType.day || ''),
    hour: parseIntSafe(byType.hour || ''),
    minute: parseIntSafe(byType.minute || ''),
    weekday,
  };
}

function normalizeTimezone(timezone?: string): string {
  const tz = (timezone || '').trim();
  if (!tz) return 'Asia/Shanghai';
  return tz;
}

function slotKey(parts: ZonedParts, timezone: string): string {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}@${timezone}`;
}

function matchCronField(field: string, value: number, min: number, max: number, isDayOfWeek = false): boolean {
  const normalizedValue = isDayOfWeek && value === 0 ? 7 : value;
  const tokens = field.split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return false;

  const matchToken = (token: string): boolean => {
    if (token === '*') return true;

    const stepIndex = token.indexOf('/');
    if (stepIndex >= 0) {
      const left = token.slice(0, stepIndex);
      const right = token.slice(stepIndex + 1);
      const step = parseIntSafe(right);
      if (!Number.isFinite(step) || step <= 0) return false;
      if (left === '*') {
        return normalizedValue % step === 0;
      }
      if (left.includes('-')) {
        const [startRaw, endRaw] = left.split('-', 2);
        const start = parseIntSafe(startRaw);
        const end = parseIntSafe(endRaw);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return false;
        if (normalizedValue < start || normalizedValue > end) return false;
        return (normalizedValue - start) % step === 0;
      }
      const base = parseIntSafe(left);
      if (!Number.isFinite(base)) return false;
      if (normalizedValue < base) return false;
      return (normalizedValue - base) % step === 0;
    }

    if (token.includes('-')) {
      const [startRaw, endRaw] = token.split('-', 2);
      const start = parseIntSafe(startRaw);
      const end = parseIntSafe(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return false;
      return normalizedValue >= start && normalizedValue <= end;
    }

    const exact = parseIntSafe(token);
    if (!Number.isFinite(exact)) return false;
    return normalizedValue === exact;
  };

  if (value < min || value > max) return false;
  return tokens.some(matchToken);
}

export function resolveScheduleSlotKey(cron: string, timezone: string, date: Date): string | null {
  const expression = (cron || '').trim();
  if (!expression) return null;
  const tz = normalizeTimezone(timezone);
  const parts = getZonedParts(date, tz);

  const daily = expression.match(DAILY_RE);
  if (daily) {
    const hour = parseIntSafe(daily[1]);
    const minute = parseIntSafe(daily[2]);
    if (parts.hour === hour && parts.minute === minute) {
      return slotKey(parts, tz);
    }
    return null;
  }

  const weekly = expression.match(WEEKLY_RE);
  if (weekly) {
    const weekday = WEEKDAY_MAP[`周${weekly[1]}`];
    const hour = parseIntSafe(weekly[2]);
    const minute = parseIntSafe(weekly[3]);
    if (weekday === undefined) return null;
    if (parts.weekday === weekday && parts.hour === hour && parts.minute === minute) {
      return slotKey(parts, tz);
    }
    return null;
  }

  const once = expression.match(ONCE_RE);
  if (once) {
    const year = parseIntSafe(once[1]);
    const month = parseIntSafe(once[2]);
    const day = parseIntSafe(once[3]);
    const hour = parseIntSafe(once[4]);
    const minute = parseIntSafe(once[5]);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return `${once[1]}-${once[2]}-${once[3]}T${String(hour).padStart(2, '0')}:${once[5]}@${tz}`;
    }
    return null;
  }

  const interval = expression.match(INTERVAL_RE);
  if (interval) {
    const value = parseIntSafe(interval[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = interval[2].toLowerCase();
    if (unit === '分钟' || unit === 'm') {
      const totalMinutes = parts.hour * 60 + parts.minute;
      if (totalMinutes % value === 0) {
        return slotKey(parts, tz);
      }
      return null;
    }
    if (parts.minute === 0 && parts.hour % value === 0) {
      return slotKey(parts, tz);
    }
    return null;
  }

  if (CRON_5_RE.test(expression)) {
    const fields = expression.split(/\s+/);
    if (fields.length !== 5) return null;
    const [minuteF, hourF, dayF, monthF, weekdayF] = fields;
    const matched =
      matchCronField(minuteF, parts.minute, 0, 59) &&
      matchCronField(hourF, parts.hour, 0, 23) &&
      matchCronField(dayF, parts.day, 1, 31) &&
      matchCronField(monthF, parts.month, 1, 12) &&
      matchCronField(weekdayF, parts.weekday, 0, 6, true);
    return matched ? slotKey(parts, tz) : null;
  }

  return null;
}

export function hasExecutedInCurrentSlot(automation: AutomationView, now: Date): boolean {
  const cron = (automation.trigger.cron || '').trim();
  if (!cron) return false;
  const timezone = normalizeTimezone(automation.trigger.timezone);
  const currentSlot = resolveScheduleSlotKey(cron, timezone, now);
  if (!currentSlot) return false;
  const lastRunAt = automation.execution.lastRunAt;
  if (!lastRunAt) return false;
  const lastDate = new Date(lastRunAt);
  if (Number.isNaN(lastDate.getTime())) return false;
  const lastSlot = resolveScheduleSlotKey(cron, timezone, lastDate);
  return lastSlot === currentSlot;
}

function shouldTriggerAutomation(automation: AutomationView, now: Date): boolean {
  if (!automation.enabled) return false;
  if (automation.trigger.type !== 'cron') return false;
  const cron = (automation.trigger.cron || '').trim();
  if (!cron) return false;
  const timezone = normalizeTimezone(automation.trigger.timezone);
  if (!resolveScheduleSlotKey(cron, timezone, now)) return false;
  if (hasExecutedInCurrentSlot(automation, now)) return false;
  return true;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly tickMs: number = 60_000,
    private readonly maxUsersPerTick: number = 500,
  ) {}

  start(): void {
    if (this.timer) return;

    const alignedDelay = this.tickMs - (Date.now() % this.tickMs);
    this.timer = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, this.tickMs);
    }, alignedDelay);
    console.log(`[AutomationScheduler] started: tick=${this.tickMs}ms maxUsers=${this.maxUsersPerTick}`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[AutomationScheduler] stopped');
  }

  private async tick(): Promise<void> {
    if (this.running) {
      console.warn('[AutomationScheduler] skip tick: previous run still in progress');
      return;
    }
    this.running = true;

    try {
      const now = new Date();
      const users = await listActiveUsers(this.maxUsersPerTick);
      if (users.length === 0) return;

      for (const user of users) {
        await this.processUser(user.id, user.linux_user, now);
      }
    } catch (error) {
      console.error('[AutomationScheduler] tick failed:', error);
    } finally {
      this.running = false;
    }
  }

  private async processUser(userId: number, linuxUserRaw: string, now: Date): Promise<void> {
    const linuxUser = sanitizeLinuxUsername(linuxUserRaw);
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run = (command: string) => sshPool.exec(connection, command);
      const runAsUser = (command: string) =>
        sshPool.exec(connection, AutomationStore.buildUserCommand(linuxUser, command));
      const store = new AutomationStore(linuxUser, run, runAsUser);
      const list = await store.listAutomations();

      for (const automation of list.automations) {
        if (!shouldTriggerAutomation(automation, now)) continue;
        try {
          const result = await store.runOnce(automation.id);
          console.info(
            `[AutomationScheduler] fired user=${userId} linuxUser=${linuxUser} id=${automation.id} at=${result.run.executedAt}`,
          );
        } catch (error) {
          console.error(
            `[AutomationScheduler] run failed user=${userId} linuxUser=${linuxUser} id=${automation.id}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(`[AutomationScheduler] process user failed user=${userId} linuxUser=${linuxUser}:`, error);
    } finally {
      sshPool.release(connection);
    }
  }
}
