import type { InstallSkillResult, SkillActionResult, SkillDetailResult, SkillsContext, SkillsListResult, SkillInfo, SkillDefinition } from './types.js';

export interface ISkillsService {
  getMarketSkills(): SkillDefinition[];
  ensureBuiltinSkills(context: SkillsContext): Promise<number>;
  listSkills(context: SkillsContext): Promise<SkillsListResult>;
  getSkillDetail(context: SkillsContext, skillId: string): Promise<SkillDetailResult>;
  searchSkills(context: SkillsContext, query: string): Promise<SkillInfo[]>;
  subscribeSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult>;
  installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult>;
  upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
  useSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
}
