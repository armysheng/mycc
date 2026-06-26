export interface AuthRateLimitOptions {
  now?: () => number;
  windowMs?: number;
  maxAttempts?: number;
}

export interface AuthRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface AttemptBucket {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

export class InMemoryAuthRateLimiter {
  private readonly buckets = new Map<string, AttemptBucket>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(options: AuthRateLimitOptions = {}) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  check(key: string): AuthRateLimitResult {
    const now = this.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return { allowed: true };
    }

    if (current.count >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export function buildAuthRateLimitKey(params: {
  action: 'login' | 'register';
  ip: string;
  credential?: string;
}): string {
  const credential = params.credential?.trim().toLowerCase() || 'anonymous';
  return `${params.action}:${params.ip}:${credential}`;
}
