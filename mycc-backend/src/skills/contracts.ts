import type { InstallSkillResult, SkillActionResult, SkillsContext, SkillsListResult, SkillInfo } from './types.js';

export interface ISkillsService {
  listSkills(context: SkillsContext): Promise<SkillsListResult>;
  searchSkills(context: SkillsContext, query: string): Promise<SkillInfo[]>;
  installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult>;
  upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
}
