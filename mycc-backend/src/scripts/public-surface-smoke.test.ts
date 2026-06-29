import { describe, expect, it, vi } from 'vitest';
import { runPublicSurfaceSmoke } from './public-surface-smoke.js';

function textResponse(status: number, body: string, contentType = 'text/plain'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const homeHtml = `
<!doctype html>
<html>
  <head>
    <title>道友 AI</title>
    <meta name="description" content="道友 AI，念头通达出品的个人生产力 AI 助手。" />
    <link rel="stylesheet" href="/assets/index-demo.css" />
    <script type="module" src="/assets/index-demo.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

describe('public surface smoke', () => {
  it('includes the failing check label, URL, and cause when a request throws', async () => {
    const fetchError = new TypeError('fetch failed');
    Object.defineProperty(fetchError, 'cause', {
      value: new Error('connect ETIMEDOUT 203.0.113.10:443'),
    });
    const fetchMock = vi.fn(async () => {
      throw fetchError;
    });

    await expect(runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test',
      fetch: fetchMock,
    })).rejects.toThrow(
      /health request failed.*https:\/\/daoyou\.example\.test\/health.*fetch failed.*ETIMEDOUT/,
    );
  });

  it('checks only public no-side-effect endpoints and static assets', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      if (url === 'https://daoyou.example.test/health') {
        return jsonResponse(200, { status: 'ok' });
      }
      if (url === 'https://daoyou.example.test/readyz') {
        return jsonResponse(200, { ready: true, status: 'ok' });
      }
      if (url === 'https://daoyou.example.test/readyz/deep') {
        return jsonResponse(401, { error: 'readyz_deep_unauthorized', status: 'unauthorized' });
      }
      if (url === 'https://daoyou.example.test/api/auth/config') {
        return jsonResponse(200, {
          success: true,
          data: {
            registration: {
              mode: 'closed',
              enabled: false,
              inviteRequired: false,
            },
          },
        });
      }
      if (url === 'https://daoyou.example.test/') {
        return textResponse(200, homeHtml, 'text/html');
      }
      if (url === 'https://daoyou.example.test/favicon.svg') {
        return textResponse(200, '<svg />', 'image/svg+xml');
      }
      if (
        url === 'https://daoyou.example.test/assets/index-demo.js'
        || url === 'https://daoyou.example.test/assets/index-demo.css'
      ) {
        return textResponse(200, 'asset ok');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test/',
      fetch: fetchMock,
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      'https://daoyou.example.test/health',
      'https://daoyou.example.test/readyz',
      'https://daoyou.example.test/readyz/deep',
      'https://daoyou.example.test/api/auth/config',
      'https://daoyou.example.test/',
      'https://daoyou.example.test/favicon.svg',
      'https://daoyou.example.test/assets/index-demo.css',
      'https://daoyou.example.test/assets/index-demo.js',
    ]);
    expect(urls.some((url) => /\/api\/(auth\/register|chat|onboarding)/.test(url))).toBe(false);
  });

  it('rejects public HTML that exposes provider implementation terms', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      if (url.endsWith('/readyz')) return jsonResponse(200, { ready: true });
      if (url.endsWith('/readyz/deep')) return jsonResponse(401, { error: 'readyz_deep_unauthorized' });
      if (url.endsWith('/api/auth/config')) {
        return jsonResponse(200, { success: true, data: { registration: { mode: 'closed' } } });
      }
      if (url.endsWith('/')) {
        return textResponse(200, homeHtml.replace('<div id="root"></div>', '<div>E2B linuxUser</div>'), 'text/html');
      }
      if (url.endsWith('/favicon.svg')) return textResponse(200, '<svg />', 'image/svg+xml');
      if (url.includes('/assets/')) return textResponse(200, 'asset ok');
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test',
      fetch: fetchMock,
    })).rejects.toThrow(/public HTML leaked/i);
  });

  it('rejects unreadable favicon assets', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      if (url.endsWith('/readyz')) return jsonResponse(200, { ready: true });
      if (url.endsWith('/readyz/deep')) return jsonResponse(401, { error: 'readyz_deep_unauthorized' });
      if (url.endsWith('/api/auth/config')) {
        return jsonResponse(200, { success: true, data: { registration: { mode: 'closed' } } });
      }
      if (url.endsWith('/')) return textResponse(200, homeHtml, 'text/html');
      if (url.endsWith('/favicon.svg')) return textResponse(403, 'forbidden');
      if (url.includes('/assets/')) return textResponse(200, 'asset ok');
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test',
      fetch: fetchMock,
    })).rejects.toThrow(/favicon/i);
  });

  it('rejects public registration when closed mode is expected', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      if (url.endsWith('/readyz')) return jsonResponse(200, { ready: true });
      if (url.endsWith('/readyz/deep')) return jsonResponse(401, { error: 'readyz_deep_unauthorized' });
      if (url.endsWith('/api/auth/config')) {
        return jsonResponse(200, { success: true, data: { registration: { mode: 'open' } } });
      }
      if (url.endsWith('/')) return textResponse(200, homeHtml, 'text/html');
      if (url.endsWith('/favicon.svg')) return textResponse(200, '<svg />', 'image/svg+xml');
      if (url.includes('/assets/')) return textResponse(200, 'asset ok');
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test',
      expectedRegistrationMode: 'closed',
      fetch: fetchMock,
    })).rejects.toThrow(/registration mode/i);
  });

  it('rejects unauthorized deep readiness responses that expose internal checks', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      if (url.endsWith('/readyz')) return jsonResponse(200, { ready: true });
      if (url.endsWith('/readyz/deep')) {
        return jsonResponse(401, {
          error: 'readyz_deep_unauthorized',
          checks: { runtime: { status: 'fail' } },
        });
      }
      if (url.endsWith('/api/auth/config')) {
        return jsonResponse(200, { success: true, data: { registration: { mode: 'closed' } } });
      }
      if (url.endsWith('/')) return textResponse(200, homeHtml, 'text/html');
      if (url.endsWith('/favicon.svg')) return textResponse(200, '<svg />', 'image/svg+xml');
      if (url.includes('/assets/')) return textResponse(200, 'asset ok');
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(runPublicSurfaceSmoke({
      baseUrl: 'https://daoyou.example.test',
      fetch: fetchMock,
    })).rejects.toThrow(/deep readiness/i);
  });
});
