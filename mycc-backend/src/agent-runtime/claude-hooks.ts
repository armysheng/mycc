import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

export type MyccClaudeHookOptions = {
  dangerousBashGuard?: boolean;
};

const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-[^&|;]*r[^&|;]*f\s+(?:\/|\$HOME|~)(?:\s|$)/i,
    reason: 'recursive force delete against a root or home path',
  },
  {
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: 'host shutdown command',
  },
  {
    pattern: /\b(?:mkfs|fdisk|parted|diskutil)\b/i,
    reason: 'disk mutation command',
  },
  {
    pattern: /\bdd\s+if=.*\bof=\/dev\//i,
    reason: 'raw device write command',
  },
  {
    pattern: /\bchmod\s+-R\s+777\s+(?:\/|\$HOME|~)(?:\s|$)/i,
    reason: 'recursive world-writable permission change',
  },
  {
    pattern: /\bcurl\b[^|;&]*\|\s*(?:sh|bash)\b/i,
    reason: 'remote script pipe to shell',
  },
  {
    pattern: /\bwget\b[^|;&]*\|\s*(?:sh|bash)\b/i,
    reason: 'remote script pipe to shell',
  },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
    reason: 'fork bomb pattern',
  },
];

export function createMyccClaudeHooks(
  options: MyccClaudeHookOptions = {},
): Partial<Record<string, HookCallbackMatcher[]>> {
  const dangerousBashGuard = options.dangerousBashGuard ?? true;
  if (!dangerousBashGuard) return {};

  return {
    PreToolUse: [
      {
        hooks: [guardDangerousBashToolUse],
      },
    ],
  };
}

export async function guardDangerousBashToolUse(
  input: HookInput,
): Promise<HookJSONOutput> {
  if (!isPreToolUse(input) || input.tool_name !== 'Bash') {
    return { continue: true };
  }

  const command = readBashCommand(input.tool_input);
  if (!command) {
    return { continue: true };
  }

  const matched = DANGEROUS_BASH_PATTERNS.find(({ pattern }) => pattern.test(command));
  if (!matched) {
    return { continue: true };
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `MyCC blocked dangerous Bash command: ${matched.reason}.`,
    },
  };
}

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

function readBashCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : null;
}
