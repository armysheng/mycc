import { afterEach, describe, expect, it, vi } from 'vitest';
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

function authConfigResponse(mode: 'open' | 'invite' | 'closed' = 'open'): Response {
  return jsonResponse(200, {
    success: true,
    data: {
      registration: {
        mode,
      },
    },
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('auth smoke gates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse();
      }
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
            status: 'ready',
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
      'http://127.0.0.1:8080/api/auth/config',
      'http://127.0.0.1:8080/api/auth/register',
      'http://127.0.0.1:8080/api/onboarding/initialize',
      'http://127.0.0.1:8080/api/auth/me',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'POST', 'GET']);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat'))).toBe(false);
    expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({
      Authorization: 'Bearer jwt-token',
    });
  });

  it('onboarding smoke logs in with an explicit test account when registration is closed', async () => {
    vi.stubEnv('MYCC_AUTH_SMOKE_CREDENTIAL', 'existing-smoke@example.test');
    vi.stubEnv('MYCC_AUTH_SMOKE_PASSWORD', 'ExistingSmokePass-1!');

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse('closed');
      }
      if (url.endsWith('/api/auth/login')) {
        expect(requestBody(init)).toMatchObject({
          credential: 'existing-smoke@example.test',
          password: 'ExistingSmokePass-1!',
        });
        return jsonResponse(200, {
          success: true,
          data: {
            token: 'existing-jwt-token',
            user: {
              id: 43,
              email: 'existing-smoke@example.test',
              is_initialized: true,
            },
          },
        });
      }
      if (url.endsWith('/api/onboarding/initialize')) {
        return jsonResponse(200, {
          success: true,
          data: {
            status: 'ready',
          },
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse(200, {
          success: true,
          data: {
            id: 43,
            email: 'existing-smoke@example.test',
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
      'http://127.0.0.1:8080/api/auth/config',
      'http://127.0.0.1:8080/api/auth/login',
      'http://127.0.0.1:8080/api/onboarding/initialize',
      'http://127.0.0.1:8080/api/auth/me',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/register'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat'))).toBe(false);
    expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({
      Authorization: 'Bearer existing-jwt-token',
    });
  });

  it('onboarding smoke accepts onboarding-specific credentials when registration is closed', async () => {
    vi.stubEnv('MYCC_AUTH_SMOKE_CREDENTIAL', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_EMAIL', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_PHONE', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_PASSWORD', '');
    vi.stubEnv('MYCC_AUTH_ONBOARDING_SMOKE_CREDENTIAL', 'onboarding-smoke@example.test');
    vi.stubEnv('MYCC_AUTH_ONBOARDING_SMOKE_PASSWORD', 'OnboardingSmokePass-1!');

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse('closed');
      }
      if (url.endsWith('/api/auth/login')) {
        expect(requestBody(init)).toMatchObject({
          credential: 'onboarding-smoke@example.test',
          password: 'OnboardingSmokePass-1!',
        });
        return jsonResponse(200, {
          success: true,
          data: {
            token: 'onboarding-jwt-token',
            user: {
              id: 45,
              email: 'onboarding-smoke@example.test',
              is_initialized: true,
            },
          },
        });
      }
      if (url.endsWith('/api/onboarding/initialize')) {
        return jsonResponse(200, {
          success: true,
          data: {
            status: 'ready',
          },
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse(200, {
          success: true,
          data: {
            id: 45,
            email: 'onboarding-smoke@example.test',
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
      'http://127.0.0.1:8080/api/auth/config',
      'http://127.0.0.1:8080/api/auth/login',
      'http://127.0.0.1:8080/api/onboarding/initialize',
      'http://127.0.0.1:8080/api/auth/me',
    ]);
  });

  it('onboarding smoke fails before registration when registration is closed without explicit credentials', async () => {
    vi.stubEnv('MYCC_AUTH_SMOKE_CREDENTIAL', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_EMAIL', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_PHONE', '');
    vi.stubEnv('MYCC_AUTH_SMOKE_PASSWORD', '');

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse('closed');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runAuthOnboardingSmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    })).rejects.toThrow(/MYCC_AUTH_SMOKE_CREDENTIAL.*MYCC_AUTH_SMOKE_PASSWORD/i);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8080/api/auth/config',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/register'))).toBe(false);
  });

  it('onboarding smoke fails before registration when invite mode lacks an invite code', async () => {
    vi.stubEnv('MYCC_AUTH_SMOKE_INVITE_CODE', '');

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse('invite');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runAuthOnboardingSmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    })).rejects.toThrow(/MYCC_AUTH_SMOKE_INVITE_CODE/i);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8080/api/auth/config',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/register'))).toBe(false);
  });

  it('onboarding smoke registers with an invite code when registration is invite-only', async () => {
    vi.stubEnv('MYCC_AUTH_SMOKE_INVITE_CODE', 'invite-smoke-code');

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse('invite');
      }
      if (url.endsWith('/api/auth/register')) {
        expect(requestBody(init)).toMatchObject({
          inviteCode: 'invite-smoke-code',
        });
        return jsonResponse(201, {
          success: true,
          data: {
            token: 'invite-jwt-token',
            user: {
              id: 44,
              email: 'invite-smoke@example.test',
              is_initialized: false,
            },
          },
        });
      }
      if (url.endsWith('/api/onboarding/initialize')) {
        return jsonResponse(200, {
          success: true,
          data: {
            status: 'ready',
          },
        });
      }
      if (url.endsWith('/api/auth/me')) {
        return jsonResponse(200, {
          success: true,
          data: {
            id: 44,
            email: 'invite-smoke@example.test',
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
      'http://127.0.0.1:8080/api/auth/config',
      'http://127.0.0.1:8080/api/auth/register',
      'http://127.0.0.1:8080/api/onboarding/initialize',
      'http://127.0.0.1:8080/api/auth/me',
    ]);
    expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({
      Authorization: 'Bearer invite-jwt-token',
    });
  });

  it('onboarding smoke rejects responses that expose linux users', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse();
      }
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

  it('onboarding smoke rejects camelCase linux user details and legacy bootstrap prompts', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse();
      }
      if (url.endsWith('/api/auth/register')) {
        return jsonResponse(201, {
          success: true,
          data: {
            token: 'jwt-token',
            user: { id: 18, email: 'smoke@example.test', is_initialized: false },
          },
        });
      }
      if (url.endsWith('/api/onboarding/initialize')) {
        return jsonResponse(200, {
          success: true,
          data: {
            linuxUser: 'mycc_u18',
            bootstrapPrompt: '请调用 /api/chat 完成初始化',
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

  it('onboarding smoke rejects legacy bootstrap-only initialize responses', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/config')) {
        return authConfigResponse();
      }
      if (url.endsWith('/api/auth/register')) {
        return jsonResponse(201, {
          success: true,
          data: {
            token: 'jwt-token',
            user: { id: 18, email: 'smoke@example.test', is_initialized: false },
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
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runAuthOnboardingSmoke({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: fetchMock,
    })).rejects.toThrow(/ready status/i);
  });
});
