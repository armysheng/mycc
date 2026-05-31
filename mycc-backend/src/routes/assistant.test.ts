import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { assistantRoutes, type AssistantRoutesOptions } from './assistant.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_secret_123',
  codeServerPid: 1234,
  host: '18080-sbx-secret.e2b.app',
  trafficAccessToken: 'e2b_live_secret_123456',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token-secret',
  userId: 42,
  status: 'running',
};

function authHeader(): string {
  const token = jwt.sign({
    userId: 42,
    linuxUser: 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: AssistantRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(assistantRoutes, options);
  return app;
}

function defaultOptions(): AssistantRoutesOptions {
  const sessionStore = new InMemoryIdeSessionStore();
  return {
    sessionStore,
    getUserConversations: vi.fn().mockResolvedValue([
      {
        sessionId: 'session_abc',
        title: '调研 Claude Code UI',
        messageCount: 6,
        totalTokens: 1200,
        createdAt: new Date('2026-05-29T10:00:00.000Z'),
        updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      },
    ]),
    findUserById: vi.fn().mockResolvedValue({
      id: 42,
      email: 'tester@example.com',
      password_hash: 'hash',
      assistant_name: '小麦',
      linux_user: 'tester',
      status: 'active',
      is_initialized: true,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
      updated_at: new Date('2026-05-30T00:00:00.000Z'),
    }),
  };
}

async function buildAppWithRunningSession(overrides: Partial<AssistantRoutesOptions> = {}) {
  const options = defaultOptions();
  await options.sessionStore!.set(runningSession);
  return buildApp({
    ...options,
    ...overrides,
    sessionStore: overrides.sessionStore ?? options.sessionStore,
  });
}

describe('assistant routes', () => {
  it('requires auth for assistant home', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '未提供认证 token' });
    await app.close();
  });

  it('maps conversations to recent task-like cards without durable task states', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tasks[0]).toMatchObject({
      id: 'session_abc',
      source: 'conversation',
      status: 'recent',
      title: '调研 Claude Code UI',
      messageCount: 6,
    });
    expect(body.data.tasks[0].status).not.toMatch(/blocked|completed|failed|verified/);
    await app.close();
  });

  it('filters bootstrap and control conversations out of assistant home tasks', async () => {
    const options = defaultOptions();
    options.getUserConversations = vi.fn().mockResolvedValue([
      {
        sessionId: 'session_bootstrap',
        title: '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
        messageCount: 1,
        totalTokens: 800,
        createdAt: new Date('2026-05-30T08:00:00.000Z'),
        updatedAt: new Date('2026-05-30T08:00:00.000Z'),
      },
      {
        sessionId: 'session_continue',
        title: 'continue',
        messageCount: 4,
        totalTokens: 120,
        createdAt: new Date('2026-05-30T09:00:00.000Z'),
        updatedAt: new Date('2026-05-30T09:00:00.000Z'),
      },
      {
        sessionId: 'session_accept',
        title: 'accept',
        messageCount: 1,
        totalTokens: 20,
        createdAt: new Date('2026-05-30T09:10:00.000Z'),
        updatedAt: new Date('2026-05-30T09:10:00.000Z'),
      },
      {
        sessionId: 'session_init_failed',
        title: '初始化流程执行失败：BOOTSTRAP.md 未归档',
        messageCount: 2,
        totalTokens: 300,
        createdAt: new Date('2026-05-30T09:30:00.000Z'),
        updatedAt: new Date('2026-05-30T09:30:00.000Z'),
      },
      {
        sessionId: 'session_user_task',
        title: '整理当前项目状态',
        messageCount: 6,
        totalTokens: 1200,
        createdAt: new Date('2026-05-30T10:00:00.000Z'),
        updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      },
    ]);
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tasks.map((task: { title: string }) => task.title)).toEqual([
      '整理当前项目状态',
    ]);
    expect(response.body).not.toContain('首次初始化');
    expect(response.body).not.toContain('"continue"');
    expect(response.body).not.toContain('"accept"');
    expect(response.body).not.toContain('BOOTSTRAP.md');
    await app.close();
  });

  it('deduplicates repeated recent conversations and hides low-signal placeholders', async () => {
    const options = defaultOptions();
    options.getUserConversations = vi.fn().mockResolvedValue([
      {
        sessionId: 'session_status_latest',
        title: '整理当前项目状态',
        messageCount: 8,
        totalTokens: 1400,
        createdAt: new Date('2026-05-30T12:00:00.000Z'),
        updatedAt: new Date('2026-05-30T12:00:00.000Z'),
      },
      {
        sessionId: 'session_status_old',
        title: '整理当前项目状态',
        messageCount: 5,
        totalTokens: 900,
        createdAt: new Date('2026-05-30T10:00:00.000Z'),
        updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      },
      {
        sessionId: 'session_placeholder',
        title: '最近会话',
        messageCount: 1,
        totalTokens: 20,
        createdAt: new Date('2026-05-30T09:00:00.000Z'),
        updatedAt: new Date('2026-05-30T09:00:00.000Z'),
      },
      {
        sessionId: 'session_real_one_shot',
        title: '总结今天产品进展',
        messageCount: 1,
        totalTokens: 700,
        createdAt: new Date('2026-05-30T08:00:00.000Z'),
        updatedAt: new Date('2026-05-30T08:00:00.000Z'),
      },
    ]);
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tasks.map((task: { id: string; title: string }) => ({
      id: task.id,
      title: task.title,
    }))).toEqual([
      { id: 'session_status_latest', title: '整理当前项目状态' },
      { id: 'session_real_one_shot', title: '总结今天产品进展' },
    ]);
    expect(response.body).not.toContain('session_status_old');
    expect(body.data.tasks.map((task: { title: string }) => task.title)).not.toContain('最近会话');
    await app.close();
  });

  it('labels memory sources separately', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/memory',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.sources.map((source: { kind: string }) => source.kind)).toEqual([
      'profile',
      'project_context',
      'long_term_memory',
    ]);
    await app.close();
  });

  it('keeps assistant memory public contract product-facing', async () => {
    const app = await buildApp(defaultOptions());

    for (const url of ['/api/assistant/home', '/api/assistant/memory']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: authHeader() },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const sources = url === '/api/assistant/home'
        ? body.data.memory.sources
        : body.data.sources;
      expect(sources.map((source: { kind: string }) => source.kind)).toEqual([
        'profile',
        'project_context',
        'long_term_memory',
      ]);
      expect(sources.map((source: { status: string }) => source.status)).toEqual([
        'available',
        'pending',
        'managed',
      ]);
      expect(response.body).not.toMatch(/runtime|available_when_workspace_running|managed_by_runtime/i);
    }

    await app.close();
  });

  it('returns instructional deliverable empty state before artifact registry exists', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        deliverables: [],
        emptyState: expect.objectContaining({
          title: '还没有制品',
        }),
      },
    });
    await app.close();
  });

  it('keeps assistant home public contract product-facing without workbench internals', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.workspace).toEqual(expect.objectContaining({
      status: 'inactive',
      label: '当前没有活跃项目空间',
      description: '需要处理文件或代码时，助理会准备项目空间。',
    }));
    expect(body.data.capabilities).toEqual([
      expect.objectContaining({
        id: 'workbench',
        label: '工作间',
        status: 'disabled',
        actionLabel: '准备工作间',
      }),
      expect.objectContaining({
        id: 'desktop',
        label: '桌面工作间',
        status: 'disabled',
        hidden: true,
      }),
    ]);
    expect(body.data.emptyStates).toEqual(expect.objectContaining({
      tasks: '告诉助理你想完成什么，最近对话会出现在这里。',
      deliverables: '助理产出的报告、文件、预览和协作记录会出现在这里。',
      memory: '补充偏好和项目背景后，助理会更懂你的工作方式。',
      workspace: '需要处理文件或代码时，助理会准备项目空间。',
    }));
    expect(response.body).not.toMatch(/code-server|needs_workspace|Remote IDE|sandbox|E2B|CCR|Agent SDK/i);
    expect(response.body).not.toMatch(/Start by asking|Useful outputs|Create a workspace/i);
    await app.close();
  });

  it('derives safe markdown deliverable cards from the current E2B workspace', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          path: '/docs/research-report.md',
          title: 'Claude UI 调研报告',
          size: 2048,
          mtime: '2026-05-30T10:00:00.000Z',
        },
        {
          path: '/docs/.env-plan.md',
          title: 'secret plan',
          size: 1024,
          mtime: '2026-05-30T11:00:00.000Z',
        },
        {
          path: '/notes/random.md',
          title: 'Random note',
          size: 512,
          mtime: '2026-05-30T12:00:00.000Z',
        },
      ]),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ide_123' }),
      expect.stringContaining('DELIVERABLE_SCAN_SCRIPT'),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 8000,
      }),
    );
    expect(body.data.deliverables).toEqual([
      expect.objectContaining({
        kind: 'report',
        title: 'Claude UI 调研报告',
        source: 'current_workspace',
        status: 'ready',
        path: '/docs/research-report.md',
        updatedAt: '2026-05-30T10:00:00.000Z',
      }),
    ]);
    expect(response.body).not.toContain('.env-plan.md');
    expect(response.body).not.toContain('Random note');
    await app.close();
  });

  it('classifies preview, screenshot, log, and diff deliverables from the current workspace', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          path: '/output/app-preview.html',
          title: 'App Preview',
          size: 4096,
          mtime: '2026-05-30T12:00:00.000Z',
        },
        {
          path: '/screenshots/homepage-screenshot.png',
          title: 'Homepage screenshot',
          size: 8192,
          mtime: '2026-05-30T12:05:00.000Z',
        },
        {
          path: '/logs/agent-run.log',
          title: 'Agent run log',
          size: 2048,
          mtime: '2026-05-30T12:10:00.000Z',
        },
        {
          path: '/reports/ui-change.diff',
          title: 'UI change diff',
          size: 1024,
          mtime: '2026-05-30T12:15:00.000Z',
        },
        {
          path: '/output/.secret-preview.html',
          title: 'secret preview',
          size: 1024,
          mtime: '2026-05-30T12:20:00.000Z',
        },
      ]),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deliverables).toEqual([
      expect.objectContaining({ kind: 'diff', path: '/reports/ui-change.diff' }),
      expect.objectContaining({ kind: 'log', path: '/logs/agent-run.log' }),
      expect.objectContaining({ kind: 'screenshot', path: '/screenshots/homepage-screenshot.png' }),
      expect.objectContaining({ kind: 'preview', path: '/output/app-preview.html' }),
    ]);
    expect(response.body).not.toContain('.secret-preview.html');
    await app.close();
  });

  it('includes document and dataset file deliverables produced by office-capable skills', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          path: '/deliverables/product-roadmap.pdf',
          title: '产品路线图 PDF',
          size: 8192,
          mtime: '2026-05-31T10:00:00.000Z',
        },
        {
          path: '/deliverables/customer-interview.docx',
          title: '客户访谈文档',
          size: 16384,
          mtime: '2026-05-31T10:05:00.000Z',
        },
        {
          path: '/reports/revenue-analysis.xlsx',
          title: '营收分析表',
          size: 32768,
          mtime: '2026-05-31T10:10:00.000Z',
        },
        {
          path: '/output/research-dataset.csv',
          title: '调研数据集',
          size: 4096,
          mtime: '2026-05-31T10:15:00.000Z',
        },
      ]),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deliverables).toEqual([
      expect.objectContaining({
        kind: 'dataset',
        path: '/output/research-dataset.csv',
        title: '调研数据集',
      }),
      expect.objectContaining({
        kind: 'dataset',
        path: '/reports/revenue-analysis.xlsx',
        title: '营收分析表',
      }),
      expect.objectContaining({
        kind: 'document',
        path: '/deliverables/customer-interview.docx',
        title: '客户访谈文档',
      }),
      expect.objectContaining({
        kind: 'document',
        path: '/deliverables/product-roadmap.pdf',
        title: '产品路线图 PDF',
      }),
    ]);
    await app.close();
  });

  it('prefers safe manifest deliverables while filtering sensitive registry and scan entries', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        manifest: [
          {
            path: '/reports/final-report.md',
            title: '最终交付报告',
            kind: 'report',
            mtime: '2026-05-30T13:00:00.000Z',
          },
          {
            path: '/reports/token-leak-report.md',
            title: 'token leak report',
            kind: 'report',
          },
        ],
        scan: [
          {
            path: '/reports/final-report.md',
            title: '扫描出来的同路径旧报告',
            size: 4096,
            mtime: '2026-05-30T14:00:00.000Z',
          },
          {
            path: '/reports/scanned-report.md',
            title: '扫描出来的旧报告',
            size: 2048,
            mtime: '2026-05-30T12:00:00.000Z',
          },
          {
            path: '/logs/auth-token.log',
            title: 'token log',
            size: 1024,
            mtime: '2026-05-30T15:00:00.000Z',
          },
        ],
      }),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deliverables).toEqual([
      expect.objectContaining({
        id: 'workspace:/reports/final-report.md',
        kind: 'report',
        title: '最终交付报告',
        path: '/reports/final-report.md',
        updatedAt: '2026-05-30T13:00:00.000Z',
      }),
      expect.objectContaining({
        title: '扫描出来的旧报告',
        path: '/reports/scanned-report.md',
      }),
    ]);
    expect(response.body).not.toContain('扫描出来的同路径旧报告');
    expect(response.body).not.toContain('token leak report');
    expect(response.body).not.toContain('/logs/auth-token.log');
    await app.close();
  });

  it('reads deliverables registered by the sandbox helper and deduplicates scan fallback', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'mycc-helper-deliverables-'));
    const helperPath = path.resolve(
      process.cwd(),
      '..',
      'mycc-sandbox',
      'templates',
      'e2b-assistant-sandbox',
      'bin',
      'mycc-register-deliverable',
    );
    try {
      execFileSync(process.execPath, [
        helperPath,
        '--workspace',
        workspace,
        '--path',
        '/reports/helper-summary.md',
        '--title',
        'Helper summary',
        '--kind',
        'report',
        '--description',
        'Registered through the sandbox helper',
        '--updated-at',
        '2026-05-31T09:00:00.000Z',
      ]);
      const registry = JSON.parse(readFileSync(path.join(workspace, '.mycc/deliverables.json'), 'utf8'));
      const runCommandInSession = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          manifest: registry.deliverables,
          scan: [
            {
              path: '/reports/helper-summary.md',
              title: 'Scanned duplicate summary',
              size: 2048,
              mtime: '2026-05-31T10:00:00.000Z',
            },
            {
              path: '/reports/scan-only-report.md',
              title: 'Scan-only report',
              size: 1024,
              mtime: '2026-05-31T08:00:00.000Z',
            },
          ],
        }),
        stderr: '',
      });
      const app = await buildAppWithRunningSession({
        env: {
          MYCC_IDE_PROVIDER: 'e2b',
          MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
        },
        e2bProvider: { runCommandInSession },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/assistant/deliverables',
        headers: { authorization: authHeader() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.deliverables).toEqual([
        expect.objectContaining({
          id: 'workspace:/reports/helper-summary.md',
          kind: 'report',
          title: 'Helper summary',
          path: '/reports/helper-summary.md',
          description: 'Registered through the sandbox helper',
          updatedAt: '2026-05-31T09:00:00.000Z',
        }),
        expect.objectContaining({
          title: 'Scan-only report',
          path: '/reports/scan-only-report.md',
        }),
      ]);
      expect(response.body).not.toContain('Scanned duplicate summary');
      await app.close();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('deduplicates manifest and scan entries by normalized workspace path', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        manifest: [
          {
            path: 'reports/research-report.md',
            title: 'Manifest 调研报告',
            kind: 'report',
            mtime: '2026-05-30T13:00:00.000Z',
          },
        ],
        scan: [
          {
            path: '/reports/research-report.md',
            title: 'Scanned 调研报告',
            size: 2048,
            mtime: '2026-05-30T14:00:00.000Z',
          },
        ],
      }),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const deliverables = response.json().data.deliverables;
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]).toMatchObject({
      title: 'Manifest 调研报告',
      path: '/reports/research-report.md',
    });
    expect(response.body).not.toContain('Scanned 调研报告');
    await app.close();
  });

  it('falls back to scanned workspace candidates when manifest parsing fails', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        manifestError: 'Unexpected token in JSON',
        scan: [
          {
            path: '/reports/fallback-report.md',
            title: '回退扫描报告',
            size: 2048,
            mtime: '2026-05-30T12:00:00.000Z',
          },
        ],
      }),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deliverables).toEqual([
      expect.objectContaining({
        title: '回退扫描报告',
        path: '/reports/fallback-report.md',
      }),
    ]);
    expect(response.body).not.toContain('Unexpected token');
    await app.close();
  });

  it('does not leak dangerous manifest paths, secret-like urls, or token content', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        manifest: [
          {
            path: '/../secrets/report.md',
            title: '越界报告',
            kind: 'report',
          },
          {
            path: '/reports/safe-report.md',
            title: 'safe report with sk-live-secret-token',
            description: 'token=e2b_live_secret_123456',
            kind: 'report',
          },
          {
            title: '内部预览',
            kind: 'preview',
            url: 'https://18080-sbx-secret.e2b.app?token=e2b_live_secret_123456',
          },
          {
            path: '/reports/public-report.md',
            title: '公开交付报告',
            kind: 'report',
            url: '/workspace?path=%2Freports%2Fpublic-report.md',
          },
          {
            path: '/reports/external-report.md',
            title: '外部报告',
            kind: 'report',
            url: 'https://example.com/reports/public-report',
          },
        ],
        scan: [
          {
            path: '/reports/scanned-report.md',
            title: '扫描报告',
            size: 2048,
            mtime: '2026-05-30T12:00:00.000Z',
          },
        ],
      }),
      stderr: '',
    });
    const app = await buildAppWithRunningSession({
      env: {
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_WORKSPACE_DIR: '/home/mycc/workspace',
      },
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deliverables).toEqual([
      expect.objectContaining({
        title: '公开交付报告',
        path: '/reports/public-report.md',
        url: '/workspace?path=%2Freports%2Fpublic-report.md',
      }),
      expect.objectContaining({
        title: '扫描报告',
        path: '/reports/scanned-report.md',
      }),
    ]);
    expect(response.body).not.toContain('越界报告');
    expect(response.body).not.toContain('safe report with');
    expect(response.body).not.toContain('sk-live-secret-token');
    expect(response.body).not.toContain('token=e2b_live_secret_123456');
    expect(response.body).not.toContain('18080-sbx-secret.e2b.app');
    expect(response.body).not.toContain('https://example.com/reports/public-report');
    await app.close();
  });

  it('does not leak provider, runtime, or secret fields from any assistant endpoint', async () => {
    const app = await buildAppWithRunningSession({
      env: { MYCC_IDE_PROVIDER: 'disabled' },
    });

    for (const url of ['/api/assistant/home', '/api/assistant/memory', '/api/assistant/deliverables']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: authHeader() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('trafficAccessToken');
      expect(response.body).not.toContain('proxyToken');
      expect(response.body).not.toContain('e2b_live_secret_123456');
      expect(response.body).not.toContain('e2b-traffic-access-token');
      expect(response.body).not.toMatch(/[a-z0-9-]+\.e2b\.app/i);
      expect(response.body).not.toContain('https://provider.example.com/secret-route');
      expect(response.body).not.toContain('sk-provider-secret');
      expect(response.body).not.toContain('sbx_secret_123');
      expect(response.body).not.toContain('"provider"');
      expect(response.body).not.toMatch(/\be2b\b/i);
      expect(response.body).not.toMatch(/\bsandbox\b/i);
    }

    await app.close();
  });
});
