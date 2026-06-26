import type { AgentRuntimeEvent } from './types.js';

export type AgentRunnerEvent = AgentRuntimeEvent & {
  type: string;
};

export function parseAgentRunnerEventLine(line: string): AgentRunnerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    console.warn('Agent runner emitted invalid JSON:', trimmed, error);
    return null;
  }

  if (!isAgentRunnerEvent(parsed)) {
    console.warn('Agent runner emitted an invalid event:', trimmed);
    return null;
  }

  return parsed;
}

function isAgentRunnerEvent(value: unknown): value is AgentRunnerEvent {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.trim(),
  );
}
