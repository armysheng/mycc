const destructiveRollbackSqlPattern =
  /\b(?:drop\s+table(?:\s+if\s+exists)?|truncate(?:\s+table)?|delete\s+from)\s+(?:"?public"?\s*\.\s*)?"?(?:ide_sessions|agent_runs)"?/gim;

export function findForbiddenRollbackPatterns(source: string): string[] {
  return Array.from(source.matchAll(destructiveRollbackSqlPattern), (match) =>
    match[0].replace(/\s+/g, ' ').trim());
}
