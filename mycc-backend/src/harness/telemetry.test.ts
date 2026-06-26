import { describe, expect, it } from 'vitest';
import {
  isHarnessTelemetryEnabled,
  sanitizeHarnessAttributes,
  setHarnessSpanStatus,
  startHarnessSpan,
} from './telemetry.js';

describe('harness telemetry', () => {
  it('is enabled by default and can be disabled for local debugging', () => {
    expect(isHarnessTelemetryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isHarnessTelemetryEnabled({ MYCC_HARNESS_OTEL: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isHarnessTelemetryEnabled({ MYCC_OTEL_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('sanitizes attributes before they reach OpenTelemetry', () => {
    const attributes = sanitizeHarnessAttributes({
      apiKey: 'sk-secret',
      durationMs: 12,
      nested: {
        authorization: 'Bearer token',
        safe: 'hello',
      },
      unsafeLongString: 'x'.repeat(530),
    });

    expect(attributes).toEqual({
      apiKey: '[REDACTED]',
      durationMs: 12,
      nested: '{"authorization":"[REDACTED]","safe":"hello"}',
      unsafeLongString: expect.stringContaining('[truncated 18 chars]'),
    });
  });

  it('uses no-op spans when telemetry is disabled', () => {
    const span = startHarnessSpan('mycc.test', {
      password: 'secret',
    }, {
      env: { MYCC_HARNESS_OTEL: 'false' } as NodeJS.ProcessEnv,
    });

    span.addEvent('event', { token: 'secret' });
    span.setAttribute('secret', 'value');
    span.setAttributes({ authorization: 'Bearer token' });
    span.recordException(new Error('boom'));
    setHarnessSpanStatus(span, 'ok', 'done');
    expect(() => span.end()).not.toThrow();
  });
});
