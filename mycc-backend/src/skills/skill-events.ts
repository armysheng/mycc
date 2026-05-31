import {
  getSkillEventStats,
  recordSkillEvent as recordSkillEventInDb,
} from '../db/client.js';
import type { SkillEventType, SkillStats } from './types.js';

export interface RecordSkillEventInput {
  userId: number;
  skillId: string;
  eventType: SkillEventType;
  version?: string;
  source?: string;
  targetPath?: string;
  metadata?: Record<string, unknown>;
}

export async function recordSkillEvent(input: RecordSkillEventInput): Promise<void> {
  await recordSkillEventInDb(input);
}

export async function getSkillStatsMap(skillIds: string[]): Promise<Map<string, SkillStats>> {
  const uniqueIds = Array.from(new Set(skillIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await getSkillEventStats(uniqueIds);
  return new Map(rows.map((row) => [row.skillId, row.stats]));
}
