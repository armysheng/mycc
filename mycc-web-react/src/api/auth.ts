import type { LoginRequest, RegisterRequest, AuthResponse, User, UpdateProfileRequest } from '../types/auth';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const apiUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : path);

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const res = await fetch(apiUrl('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getCurrentUser(token: string): Promise<{ success: boolean; data?: User; error?: string }> {
  const res = await fetch(apiUrl('/api/auth/me'), {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

export async function initializeOnboarding(
  token: string,
  data: { assistantName: string; ownerName: string }
): Promise<{ success: boolean; data?: { bootstrapPrompt: string }; error?: string }> {
  const res = await fetch(apiUrl('/api/onboarding/initialize'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateProfile(
  token: string,
  data: UpdateProfileRequest
): Promise<{ success: boolean; data?: User; error?: string }> {
  const res = await fetch(apiUrl('/api/auth/profile'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}
