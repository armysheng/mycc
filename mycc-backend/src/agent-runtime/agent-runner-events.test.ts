import { describe, expect, it, vi } from 'vitest';
import { parseAgentRunnerEventLine } from './agent-runner-events.js';

describe('agent runner event contract', () => {
  it('accepts NDJSON object events with a type field', () => {
    expect(parseAgentRunnerEventLine('{"type":"system","session_id":"s1"}')).toEqual({
      type: 'system',
      session_id: 's1',
    });
  });

  it('ignores empty runner output lines', () => {
    expect(parseAgentRunnerEventLine('')).toBeNull();
    expect(parseAgentRunnerEventLine('   ')).toBeNull();
  });

  it('rejects non-object or untyped runner output', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseAgentRunnerEventLine('"hello"')).toBeNull();
      expect(parseAgentRunnerEventLine('[]')).toBeNull();
      expect(parseAgentRunnerEventLine('{"message":"missing type"}')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('logs malformed runner output as diagnostics instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseAgentRunnerEventLine('{invalid-json')).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Agent runner emitted invalid JSON'),
        expect.any(String),
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
