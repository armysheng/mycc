import type { InstallSkillResult, SkillActionResult, SkillsContext, SkillsListResult, SkillInfo, SkillDefinition } from './types.js';

export interface ISkillsService {
  getMarketSkills(): SkillDefinition[];
  listSkills(context: SkillsContext): Promise<SkillsListResult>;
  searchSkills(context: SkillsContext, query: string): Promise<SkillInfo[]>;
  installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult>;
  upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
}
