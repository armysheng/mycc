export type SkillStatus = "installed" | "available" | "disabled";

export interface SkillItem {
  id: string;
  name: string;
  icon: string;
  trigger: string;
  description: string;
  installed: boolean;
  status: SkillStatus;
}

export type AutomationStatus = "healthy" | "paused" | "error";

export interface AutomationItem {
  id: string;
  name: string;
  scheduleText: string;
  status: AutomationStatus;
  enabled: boolean;
}
