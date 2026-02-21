import type { InstallSkillResult, SkillActionResult, SkillsContext, SkillsListResult } from './types.js';

export interface ISkillsService {
  listSkills(context: SkillsContext): Promise<SkillsListResult>;
  installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult>;
  upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
}
