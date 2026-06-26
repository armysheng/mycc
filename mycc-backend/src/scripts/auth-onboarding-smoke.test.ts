import { describe, expect, it, vi } from 'vitest';
import {
  runAuthOnboardingSmoke,
  runAuthPrivacySmoke,
} from './auth-onboarding-smoke.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('auth smoke gates', () => {
  it('privacy smoke only posts login and requires a generic 401 without internal details', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(401, {
      success: false,
      error: '手机号/邮箱或密码错误',
    }));

    await runAuthPrivacySmoke({
      baseUrl: 'https://staging.example.test/',
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://staging.example.test/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(requestBody(init)).toMatchObject({
      password: expect.any(String),
    });
    expect(String(requestBody(init).credential)).toMatch(/@example\.test$/);
    expect(String(url)).not.toContain('/api/chat');
  });

  it('privacy smoke fails when login errors expose account or linux user details', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(401, {
      success: false,
      error: '用户不存在: mycc_u18',
    }));

    await expect(runAuthPrivacySmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    })).rejects.toThrow(/internal auth detail/i);
  });

  it('onboarding smoke registers, initializes, then reads current user without chat', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/register')) {
        return jsonResponse(201, {
          success: true,
          data: {
            token: 'jwt-token',
            user: {
              id: 42,
              email: 'smoke@example.test',
              is_initialized: false,
            },
          },
        });
      }
      if (url.endsWith('/api/onboarding/initialize')) {
        return jsonResponse(200, {
          success: true,
          data: {
            bootstrapPrompt: '初始化完成',
          },
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse(200, {
          success: true,
          data: {
            id: 42,
            email: 'smoke@example.test',
            is_initialized: true,
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await runAuthOnboardingSmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8080/api/auth/register',
      'http://127.0.0.1:8080/api/onboarding/initialize',
      'http://127.0.0.1:8080/api/auth/me',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST', 'GET']);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat'))).toBe(false);
    expect(fetchMock.mock.calls[1]![1]?.headers).toMatchObject({
      Authorization: 'Bearer jwt-token',
    });
  });

  it('onboarding smoke rejects responses that expose linux users', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/register')) {
        return jsonResponse(201, {
          success: true,
          data: {
            token: 'jwt-token',
            user: { id: 18, email: 'smoke@example.test', linux_user: 'mycc_u18' },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runAuthOnboardingSmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    })).rejects.toThrow(/internal auth detail/i);
  });
});
