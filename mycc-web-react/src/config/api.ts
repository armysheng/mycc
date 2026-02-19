// API configuration - uses relative paths with Vite proxy in development
export const API_CONFIG = {
  ENDPOINTS: {
    CHAT: "/api/chat",
    CHAT_SESSIONS: "/api/chat/sessions",
    ABORT: "/api/abort",
    SKILLS: "/api/skills",
    AUTOMATIONS: "/api/automations",
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

// Helper function to get sessions URL
export const getChatSessionsUrl = () => {
  return API_CONFIG.ENDPOINTS.CHAT_SESSIONS;
};

// Helper function to get rename session URL
export const getChatSessionRenameUrl = (sessionId: string) => {
  return `${API_CONFIG.ENDPOINTS.CHAT_SESSIONS}/${sessionId}/rename`;
};

// Helper function to get skills URL
export const getSkillsUrl = () => {
  return API_CONFIG.ENDPOINTS.SKILLS;
};

// Helper function to get automations URL
export const getAutomationsUrl = () => {
  return API_CONFIG.ENDPOINTS.AUTOMATIONS;
};

// Helper function to get auth headers
export const getAuthHeaders = (token: string | null) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};
