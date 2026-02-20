import type { LoginRequest, RegisterRequest, AuthResponse, User } from '../types/auth';
import { getNetworkErrorMessage, parseApiErrorResponse } from "../utils/apiError";
import { getAuthLoginUrl, getAuthMeUrl, getAuthRegisterUrl } from "../config/api";

export async function login(data: LoginRequest): Promise<AuthResponse> {
  try {
    const res = await fetch(getAuthLoginUrl(), {
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
    const res = await fetch(getAuthRegisterUrl(), {
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
    const res = await fetch(getAuthMeUrl(), {
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
