import type { LoginRequest, RegisterRequest, AuthResponse, User } from '../types/auth';
import { getNetworkErrorMessage, parseApiErrorResponse } from "../utils/apiError";

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

export async function login(data: LoginRequest): Promise<AuthResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const parsed = await parseApiErrorResponse(res);
      throw new Error(parsed.message);
    }
    return res.json();
  } catch (error) {
    throw new Error(getNetworkErrorMessage(error, "登录失败"));
  }
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const parsed = await parseApiErrorResponse(res);
      throw new Error(parsed.message);
    }
    return res.json();
  } catch (error) {
    throw new Error(getNetworkErrorMessage(error, "注册失败"));
  }
}

export async function getCurrentUser(token: string): Promise<{ success: boolean; data?: User; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const parsed = await parseApiErrorResponse(res);
      return { success: false, error: parsed.message };
    }
    return res.json();
  } catch (error) {
    return { success: false, error: getNetworkErrorMessage(error, "获取用户信息失败") };
  }
}
