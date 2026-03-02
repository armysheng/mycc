export type AutomationStatus = 'healthy' | 'paused' | 'error';
export type AutomationScheduleType = 'daily' | 'weekly' | 'once' | 'interval' | 'cron';

export interface AutomationTrigger {
  type: 'cron' | 'manual';
  cron?: string;
  timezone?: string;
}

export interface AutomationExecution {
  type: 'skill';
  skill: string;
  prompt: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'failed' | null;
  lastError: string | null;
}

export interface AutomationDelivery {
  type: 'inbox';
  enabled: boolean;
}

export interface AutomationRecord {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  enabled: boolean;
  trigger: AutomationTrigger;
  execution: AutomationExecution;
  delivery: AutomationDelivery;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationView extends AutomationRecord {
  scheduleText: string;
  type: AutomationScheduleType;
}

export interface AutomationListResult {
  automations: AutomationView[];
  total: number;
  migratedFromTasks: boolean;
}

export interface AutomationDocument {
  version: 1;
  updatedAt: string;
  automations: AutomationRecord[];
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  enabled?: boolean;
  status?: AutomationStatus;
  trigger: AutomationTrigger;
  execution: {
    type: 'skill';
    skill?: string;
    prompt?: string;
  };
  delivery?: Partial<AutomationDelivery>;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  status?: AutomationStatus;
  trigger?: Partial<AutomationTrigger>;
  execution?: Partial<Omit<AutomationExecution, 'runCount' | 'lastRunAt' | 'lastRunStatus' | 'lastError'>>;
  delivery?: Partial<AutomationDelivery>;
}
