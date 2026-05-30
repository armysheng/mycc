const STALE_E2B_SESSION_PATTERNS = [
  /\b404\b/i,
  /not\s+found/i,
  /does\s+not\s+exist/i,
  /no\s+such\s+sandbox/i,
  /sandbox\s+.*(?:stopped|killed|expired|terminated|not\s+running)/i,
  /(?:stopped|killed|expired|terminated)\s+.*sandbox/i,
];

export function isLikelyStaleE2bSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return STALE_E2B_SESSION_PATTERNS.some((pattern) => pattern.test(message));
}
