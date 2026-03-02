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

export type OriginType = 'official' | 'community' | 'internal-verified';

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
  /** 可访问的源码路径或官方仓库链接（internal-verified 可为空） */
  source_url: string;
  /** 来源类型：official=官方 1:1 / community=有外部出处非同名 / internal-verified=原创 */
  origin_type: OriginType;
  /** 验证方式说明（不超过 3 行） */
  validation_note: string;
  /** 最后验证日期 YYYY-MM-DD */
  last_verified_at: string;
}
