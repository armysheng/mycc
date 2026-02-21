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
}

export interface SkillsContext {
  userId: number;
  linuxUser: string;
}
