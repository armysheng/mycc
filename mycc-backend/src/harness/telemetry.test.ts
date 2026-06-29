import { describe, expect, it } from 'vitest';
import {
  isHarnessTelemetryEnabled,
  redactHarnessText,
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

  it('redacts secrets and raw provider routing details from harness command output', () => {
    const text = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
      'Set-Cookie: mycc_ide_ide_123=proxy-cookie-secret; HttpOnly; Path=/api/ide/sessions/ide_123/proxy',
      'json={"trafficAccessToken":"e2b_live_secret_value_1234567890","token":"jwt-token-secret"}',
      'host=16080-sbx_providerHost123.e2b.app',
      'keys=sk-openaiSecretValue1234567890 anthropic_secretValue1234567890 claude_secretValue1234567890',
      '[ok] public surface smoke passed',
    ].join('\n');

    const redacted = redactHarnessText(text);

    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('Set-Cookie: [REDACTED]');
    expect(redacted).toContain('"trafficAccessToken":"[REDACTED]"');
    expect(redacted).toContain('"token":"[REDACTED]"');
    expect(redacted).toContain('[REDACTED_E2B_HOST]');
    expect(redacted).toContain('[REDACTED_SECRET]');
    expect(redacted).toContain('[ok] public surface smoke passed');
    expect(redacted).not.toContain('proxy-cookie-secret');
    expect(redacted).not.toContain('e2b_live_secret_value');
    expect(redacted).not.toContain('16080-sbx_providerHost123.e2b.app');
    expect(redacted).not.toContain('sk-openaiSecretValue');
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
