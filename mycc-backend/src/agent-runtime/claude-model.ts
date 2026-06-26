export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-7';

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4.7': 'claude-opus-4-7',
};

export function normalizeClaudeModelId(model: string): string {
  const trimmed = model.trim();
  return LEGACY_MODEL_ALIASES[trimmed] || trimmed;
}
