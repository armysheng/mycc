export function extractUpMigrationSql(source: string): string {
  const [upSql] = source.split(/^--\s*Down\b.*$/im);
  return upSql.trim();
}
