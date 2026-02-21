import type { LoginRequest, RegisterRequest, AuthResponse, User } from '../types/auth';

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
