export interface User {
  id: number;
  phone?: string;
  email?: string;
  assistant_name?: string;
  plan: 'free' | 'basic' | 'pro';
  is_initialized?: boolean;
}

export interface UpdateProfileRequest {
  assistantName?: string;
}

export interface LoginRequest {
  credential: string;
  password: string;
}

export interface RegisterRequest {
  phone?: string;
  email?: string;
  password: string;
  inviteCode?: string;
}

export interface AuthResponse {
  success: boolean;
  data?: {
    token: string;
    user: User;
  };
  error?: string;
  code?: string;
}

export type RegistrationMode = 'open' | 'invite' | 'closed';
export type OAuthProvider = 'google' | 'github';

export interface OAuthProviderConfig {
  enabled: boolean;
  authUrl: string;
}

export interface AuthConfigResponse {
  success: boolean;
  data?: {
    registration: {
      mode: RegistrationMode;
      enabled: boolean;
      inviteRequired: boolean;
    };
    oauth?: {
      providers: Record<OAuthProvider, OAuthProviderConfig>;
    };
  };
  error?: string;
}
