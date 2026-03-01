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
  examplePrompt?: string;
}

export interface RegistrySkillEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  triggers: string[];
  source: 'registry';
  defaultInstall: boolean;
  examplePrompt?: string;
}

export interface SkillRegistry {
  version: number;
  skills: RegistrySkillEntry[];
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
