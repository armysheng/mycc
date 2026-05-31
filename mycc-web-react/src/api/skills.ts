import {
  getAuthHeaders,
  getSkillDisableUrl,
  getSkillEnableUrl,
  getSkillInstallUrl,
  getSkillsUrl,
  getSkillUninstallUrl,
  getSkillUpgradeUrl,
  getSkillUseUrl,
  getSkillsDebugUrl,
} from "../config/api";

export type SkillStatus = "installed" | "available" | "disabled";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  status: SkillStatus;
  installed: boolean;
  version: string;
  installedVersion: string | null;
  latestVersion: string;
  source: string;
  legacy: boolean;
  enabled: boolean;
  upgradable: boolean;
  stats?: SkillStats;
}

export interface SkillStats {
  downloads: number;
  installs: number;
  updates: number;
  uses: number;
}

export interface SkillsListResult {
  skills: SkillItem[];
  total: number;
  catalogAvailable: boolean;
}

export interface SkillInstallResult {
  skillId: string;
  installed: boolean;
  version: string;
  source: string;
  targetPath: string;
}

export interface SkillActionResult {
  skillId: string;
  success: boolean;
  enabled?: boolean;
  version?: string;
  uninstalled?: boolean;
  source?: string;
  targetPath?: string;
}

export interface SkillDebugSnapshot {
  catalogAvailable: boolean;
  marketCount: number;
  installedCount: number;
  availableCount: number;
  upgradableCount: number;
  skills: Array<Pick<
    SkillItem,
    | "id"
    | "name"
    | "source"
    | "status"
    | "installed"
    | "enabled"
    | "version"
    | "installedVersion"
    | "latestVersion"
    | "upgradable"
    | "stats"
  >>;
}

async function parseJsonOrThrow<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || fallbackError);
  }
  return json.data as T;
}

async function postSkillAction<T>(
  token: string,
  url: string,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: "{}",
  });
  return parseJsonOrThrow<T>(response, fallbackError);
}

export async function listSkills(token: string): Promise<SkillsListResult> {
  const response = await fetch(getSkillsUrl(), {
    headers: getAuthHeaders(token),
  });
  return parseJsonOrThrow<SkillsListResult>(response, "加载技能失败");
}

export async function installSkill(token: string, skillId: string): Promise<SkillInstallResult> {
  return postSkillAction<SkillInstallResult>(
    token,
    getSkillInstallUrl(skillId),
    "安装技能失败",
  );
}

export async function updateSkill(token: string, skillId: string): Promise<SkillActionResult> {
  return postSkillAction<SkillActionResult>(
    token,
    getSkillUpgradeUrl(skillId),
    "更新技能失败",
  );
}

export async function enableSkill(token: string, skillId: string): Promise<SkillActionResult> {
  return postSkillAction<SkillActionResult>(
    token,
    getSkillEnableUrl(skillId),
    "启用技能失败",
  );
}

export async function disableSkill(token: string, skillId: string): Promise<SkillActionResult> {
  return postSkillAction<SkillActionResult>(
    token,
    getSkillDisableUrl(skillId),
    "禁用技能失败",
  );
}

export async function uninstallSkill(token: string, skillId: string): Promise<SkillActionResult> {
  return postSkillAction<SkillActionResult>(
    token,
    getSkillUninstallUrl(skillId),
    "卸载技能失败",
  );
}

export async function useSkill(token: string, skillId: string): Promise<SkillActionResult> {
  return postSkillAction<SkillActionResult>(
    token,
    getSkillUseUrl(skillId),
    "记录技能使用失败",
  );
}

export async function getSkillDebugSnapshot(token: string): Promise<SkillDebugSnapshot> {
  const response = await fetch(getSkillsDebugUrl(), {
    headers: getAuthHeaders(token),
  });
  return parseJsonOrThrow<SkillDebugSnapshot>(response, "获取技能调试信息失败");
}
