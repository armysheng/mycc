export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  status: 'installed' | 'available' | 'disabled';
  installed: boolean;
  version: string;
  installedVersion: string | null;
  latestVersion: string;
  source: string;
  legacy: boolean;
  enabled: boolean;
  upgradable: boolean;
}

export interface SkillsListResult {
  skills: SkillInfo[];
  total: number;
  catalogAvailable: boolean;
}

export interface InstallSkillResult {
  skillId: string;
  installed: boolean;
  version: string;
}

export interface SkillActionResult {
  skillId: string;
  success: boolean;
  enabled?: boolean;
  version?: string;
  uninstalled?: boolean;
}

export interface SkillsContext {
  userId: number;
  linuxUser: string;
}

export type ReadinessLevel = 'L1' | 'L2' | 'L3';
export type RiskLevel = 'low' | 'medium' | 'high';
export type SkillCategory =
  | 'builtin'
  | 'productivity'
  | 'content'
  | 'learning'
  | 'lifestyle'
  | 'devtools'
  | 'research';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  category: SkillCategory;
  builtin: boolean;
  readiness: ReadinessLevel;
  deps: string[];
  riskLevel: RiskLevel;
  defaultEnabled: boolean;
  owner: string;
  mdPath: string;
}
