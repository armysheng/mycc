// API configuration - uses relative paths with Vite proxy in development
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const withBase = (path: string) => (API_BASE ? `${API_BASE}${path}` : path);

export const API_CONFIG = {
  ENDPOINTS: {
    CHAT: withBase("/api/chat"),
    CHAT_SESSIONS: withBase("/api/chat/sessions"),
    ABORT: withBase("/api/abort"),
    SKILLS: withBase("/api/skills"),
    AUTOMATIONS: withBase("/api/automations"),
    WORKSPACE: withBase("/api/workspace"),
    BILLING: withBase("/api/billing"),
    IDE: withBase("/api/ide"),
    ASSISTANT: withBase("/api/assistant"),
  },
} as const;

// Helper function to get full API URL
export const getApiUrl = (endpoint: string) => {
  return endpoint;
};

// Helper function to get abort URL
export const getAbortUrl = (requestId: string) => {
  return `${API_CONFIG.ENDPOINTS.ABORT}/${requestId}`;
};

// Helper function to get chat URL
export const getChatUrl = () => {
  return API_CONFIG.ENDPOINTS.CHAT;
};

export const getChatRuntimeConfigUrl = () => {
  return `${API_CONFIG.ENDPOINTS.CHAT}/runtime/config`;
};

// Helper function to get sessions URL
export const getChatSessionsUrl = () => {
  return API_CONFIG.ENDPOINTS.CHAT_SESSIONS;
};

// Helper function to get skills URL
export const getSkillsUrl = () => {
  return API_CONFIG.ENDPOINTS.SKILLS;
};

// Helper function to get market skills URL
export const getSkillsMarketUrl = () => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/market`;
};

// Helper function to search skills
export const getSkillsSearchUrl = (query: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/search?q=${encodeURIComponent(query)}`;
};

// Helper function to get skill install URL
export const getSkillInstallUrl = (skillId: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/${skillId}/install`;
};

export const getSkillUpgradeUrl = (skillId: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/${skillId}/upgrade`;
};

export const getSkillEnableUrl = (skillId: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/${skillId}/enable`;
};

export const getSkillDisableUrl = (skillId: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/${skillId}/disable`;
};

export const getSkillUninstallUrl = (skillId: string) => {
  return `${API_CONFIG.ENDPOINTS.SKILLS}/${encodeURIComponent(skillId)}/uninstall`;
};

// Helper function to get automations URL
export const getAutomationsUrl = () => {
  return API_CONFIG.ENDPOINTS.AUTOMATIONS;
};

export const getAutomationUpdateUrl = (automationId: string) => {
  return `${API_CONFIG.ENDPOINTS.AUTOMATIONS}/${encodeURIComponent(automationId)}`;
};

export const getAutomationDeleteUrl = (automationId: string) => {
  return `${API_CONFIG.ENDPOINTS.AUTOMATIONS}/${encodeURIComponent(automationId)}`;
};

export const getAutomationEnableUrl = (automationId: string) => {
  return `${API_CONFIG.ENDPOINTS.AUTOMATIONS}/${encodeURIComponent(automationId)}/enable`;
};

export const getAutomationDisableUrl = (automationId: string) => {
  return `${API_CONFIG.ENDPOINTS.AUTOMATIONS}/${encodeURIComponent(automationId)}/disable`;
};

export const getAutomationRunUrl = (automationId: string) => {
  return `${API_CONFIG.ENDPOINTS.AUTOMATIONS}/${encodeURIComponent(automationId)}/run`;
};

export const getWorkspaceTreeUrl = (path = "/", depth = 3) => {
  return `${API_CONFIG.ENDPOINTS.WORKSPACE}/tree?path=${encodeURIComponent(path)}&depth=${depth}`;
};

export const getWorkspaceFileUrl = (path: string) => {
  return `${API_CONFIG.ENDPOINTS.WORKSPACE}/file?path=${encodeURIComponent(path)}`;
};

export const getWorkspaceSaveFileUrl = () => {
  return `${API_CONFIG.ENDPOINTS.WORKSPACE}/file`;
};

export const getWorkspaceExecUrl = () => {
  return `${API_CONFIG.ENDPOINTS.WORKSPACE}/exec`;
};

export const getIdeConfigUrl = () => {
  return `${API_CONFIG.ENDPOINTS.IDE}/config`;
};

export const getIdeSessionsUrl = () => {
  return `${API_CONFIG.ENDPOINTS.IDE}/sessions`;
};

export const getIdeCurrentSessionUrl = () => {
  return `${API_CONFIG.ENDPOINTS.IDE}/sessions/current`;
};

export const resolveIdeOpenUrl = (openPath: string) => {
  if (/^https?:\/\//i.test(openPath)) {
    return openPath;
  }
  const base = API_BASE || window.location.origin;
  const path = openPath.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(base)) {
    return `${base}/${path}`;
  }
  return `${window.location.origin}${base ? `/${base.replace(/^\/+/, "")}` : ""}/${path}`;
};

export const getAssistantHomeUrl = () => {
  return `${API_CONFIG.ENDPOINTS.ASSISTANT}/home`;
};

export const getAssistantMemoryUrl = () => {
  return `${API_CONFIG.ENDPOINTS.ASSISTANT}/memory`;
};

export const getAssistantDeliverablesUrl = () => {
  return `${API_CONFIG.ENDPOINTS.ASSISTANT}/deliverables`;
};

export const getBillingSubscriptionUrl = () => {
  return `${API_CONFIG.ENDPOINTS.BILLING}/subscription`;
};

export const getBillingPlansUrl = () => {
  return `${API_CONFIG.ENDPOINTS.BILLING}/plans`;
};

export const getBillingUpgradeUrl = () => {
  return `${API_CONFIG.ENDPOINTS.BILLING}/upgrade`;
};

// Helper function to get session messages URL
export const getChatSessionMessagesUrl = (sessionId: string) => {
  return `${API_CONFIG.ENDPOINTS.CHAT_SESSIONS}/${sessionId}/messages`;
};

// Helper function to get rename session URL
export const getChatSessionRenameUrl = (sessionId: string) => {
  return `${API_CONFIG.ENDPOINTS.CHAT_SESSIONS}/${sessionId}/rename`;
};

// Helper function to get auth headers
export const getAuthHeaders = (token: string | null) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};
