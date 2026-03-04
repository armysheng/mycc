export interface User {
  id: number;
  phone?: string;
  email?: string;
  assistant_name?: string;
  linux_user: string;
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
}

export interface AuthResponse {
  success: boolean;
  data?: {
    token: string;
    user: User;
  };
  error?: string;
}
