import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

export type HarnessSpanStatus = 'ok' | 'error' | 'unset';

export type HarnessSpanHandle = {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
  recordException(error: unknown): void;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
  setStatus(status: HarnessSpanStatus, message?: string): void;
};

export type HarnessTelemetryOptions = {
  env?: NodeJS.ProcessEnv;
};

const TRACER_NAME = 'mycc.harness';
const TRACER_VERSION = '0.1.0';
const MAX_ATTRIBUTE_STRING_LENGTH = 512;
const MAX_ATTRIBUTE_JSON_LENGTH = 1_000;
const MAX_ATTRIBUTE_DEPTH = 6;
const SECRET_KEY_PATTERN = /(api[-_]?key|auth|authorization|credential|password|proxy[-_]?token|secret|token|traffic[-_]?access)/i;
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/(\bSet-Cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]'],
  [/\bmycc_ide_[A-Za-z0-9_-]+=[^;\s,]+/g, 'mycc_ide_[REDACTED]=[REDACTED]'],
  [/("[^"]*(?:trafficAccessToken|traffic_access_token|token|access_token|authorization|password|secret|apiKey|api_key)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"'],
  [/(\b(?:trafficAccessToken|traffic_access_token|token|access_token|authorization|password|secret|apiKey|api_key)\b\s*=\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/\b[0-9]{2,5}-sbx_[A-Za-z0-9_-]+\.e2b\.app\b/gi, '[REDACTED_E2B_HOST]'],
  [/\b(?:sk-[A-Za-z0-9_-]{20,}|e2b(?:_live)?_[A-Za-z0-9_-]{16,}|claude_[A-Za-z0-9_-]{20,}|anthropic_[A-Za-z0-9_-]{20,})\b/gi, '[REDACTED_SECRET]'],
];

export function isHarnessTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MYCC_HARNESS_OTEL !== 'false' && env.MYCC_OTEL_ENABLED !== 'false';
}

export function startHarnessSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  options: HarnessTelemetryOptions = {},
): HarnessSpanHandle {
  if (!isHarnessTelemetryEnabled(options.env)) {
    return noopHarnessSpan;
  }

  try {
    const span = trace.getTracer(TRACER_NAME, TRACER_VERSION).startSpan(name, {
      attributes: sanitizeHarnessAttributes(attributes),
    });
    return new OpenTelemetryHarnessSpan(span);
  } catch (error) {
    console.warn(
      'Harness telemetry span creation failed:',
      error instanceof Error ? error.message : String(error),
    );
    return noopHarnessSpan;
  }
}

export function setHarnessSpanStatus(
  span: HarnessSpanHandle,
  status: HarnessSpanStatus,
  message?: string,
): void {
  span.setStatus(status, message);
}

export function sanitizeHarnessAttributes(input: Record<string, unknown>): Attributes {
  const output: Attributes = {};

  for (const [key, value] of Object.entries(input)) {
    const sanitized = sanitizeHarnessAttributeValue(key, value, 0);
    if (sanitized === undefined) continue;
    output[key] = sanitized;
  }

  return output;
}

export function redactHarnessText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

function sanitizeHarnessAttributeValue(
  key: string,
  value: unknown,
  depth: number,
): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return truncate(value, MAX_ATTRIBUTE_STRING_LENGTH);
  if (value instanceof Date) return value.toISOString();

  try {
    return truncate(
      JSON.stringify(redactStructuredTelemetryValue(value, depth)),
      MAX_ATTRIBUTE_JSON_LENGTH,
    );
  } catch {
    return truncate(String(value), MAX_ATTRIBUTE_STRING_LENGTH);
  }
}

function redactStructuredTelemetryValue(value: unknown, depth: number): unknown {
  if (depth > MAX_ATTRIBUTE_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, MAX_ATTRIBUTE_STRING_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructuredTelemetryValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : redactStructuredTelemetryValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

class OpenTelemetryHarnessSpan implements HarnessSpanHandle {
  constructor(private readonly span: Span) {}

  addEvent(name: string, attributes: Record<string, unknown> = {}): void {
    this.guard(() => this.span.addEvent(name, sanitizeHarnessAttributes(attributes)));
  }

  end(): void {
    this.guard(() => this.span.end());
  }

  recordException(error: unknown): void {
    this.guard(() => {
      if (error instanceof Error) {
        this.span.recordException(error);
      } else {
        this.span.recordException(String(error));
      }
    });
  }

  setAttribute(key: string, value: unknown): void {
    const sanitized = sanitizeHarnessAttributeValue(key, value, 0);
    if (sanitized === undefined) return;
    this.guard(() => this.span.setAttribute(key, sanitized));
  }

  setAttributes(attributes: Record<string, unknown>): void {
    this.guard(() => this.span.setAttributes(sanitizeHarnessAttributes(attributes)));
  }

  setStatus(status: HarnessSpanStatus, message?: string): void {
    this.guard(() => {
      if (status === 'ok') {
        this.span.setStatus({ code: SpanStatusCode.OK, message });
        return;
      }
      if (status === 'error') {
        this.span.setStatus({ code: SpanStatusCode.ERROR, message });
        return;
      }
      this.span.setStatus({ code: SpanStatusCode.UNSET, message });
    });
  }

  private guard(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      console.warn(
        'Harness telemetry operation failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

const noopHarnessSpan: HarnessSpanHandle = {
  addEvent: () => {},
  end: () => {},
  recordException: () => {},
  setAttribute: () => {},
  setAttributes: () => {},
  setStatus: () => {},
};
