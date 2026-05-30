import { describe, expect, it, vi } from 'vitest';
import {
  hasUsableBootstrapContent,
  loadWorkspaceBootstrapFilesFromE2b,
  parseOnboardingBootstrapRequest,
  shouldLoadProjectContextFromVpsWorkspace,
} from './chat.js';
import type { StoredIdeSession } from '../ide/session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_123',
  codeServerPid: 1234,
  host: '18080-sbx_123.e2b.app',
  trafficAccessToken: 'traffic-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

describe('parseOnboardingBootstrapRequest', () => {
  it('extracts assistant name from onboarding bootstrap prompt', () => {
    const message = [
      '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
      '2. 按以下信息个性化初始化：',
      '   - 初始化票据：ticket-abc',
      '   - 助手名称：韩立',
      '   - 用户称呼：元婴',
    ].join('\n');
    expect(parseOnboardingBootstrapRequest(message)).toEqual({
      bootstrapToken: 'ticket-abc',
      assistantName: '韩立',
      ownerName: '元婴',
    });
  });

  it('returns null for non-onboarding message', () => {
    expect(parseOnboardingBootstrapRequest('你好，今天天气怎么样')).toBeNull();
  });

  it('returns null when onboarding marker exists but token is missing', () => {
    const message = [
      '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
      '2. 按以下信息个性化初始化：',
      '   - 助手名称：韩立',
      '   - 用户称呼：元婴',
    ].join('\n');
    expect(parseOnboardingBootstrapRequest(message)).toBeNull();
  });

  it('does not load VPS project context for E2B runtimes', () => {
    expect(shouldLoadProjectContextFromVpsWorkspace({
      MYCC_AGENT_RUNTIME: 'remote-claude',
    })).toBe(true);
    expect(shouldLoadProjectContextFromVpsWorkspace({
      MYCC_AGENT_RUNTIME: 'claude-agent-sdk',
    })).toBe(true);
    expect(shouldLoadProjectContextFromVpsWorkspace({
      MYCC_AGENT_RUNTIME: 'e2b-claude-cli',
    })).toBe(false);
    expect(shouldLoadProjectContextFromVpsWorkspace({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
    })).toBe(false);
  });

  it('loads bootstrap context files from the running E2B sandbox workspace', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: 'README.md',
          path: '/home/mycc/workspace/0-System/about-me/README.md',
          content: 'hello from e2b',
          missing: false,
        },
      ]),
      stderr: '',
    });

    const files = await loadWorkspaceBootstrapFilesFromE2b({
      session: runningSession,
      workspaceDir: '/home/mycc/workspace',
      e2bProvider: { runCommandInSession },
    });

    expect(files).toEqual([
      {
        name: 'README.md',
        path: '/home/mycc/workspace/0-System/about-me/README.md',
        content: 'hello from e2b',
        missing: false,
      },
    ]);
    expect(runCommandInSession).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining('node -e'),
      {
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      },
    );
    const command = runCommandInSession.mock.calls[0]![1] as string;
    expect(command).toContain('/home/mycc/workspace/0-System/about-me/README.md');
    expect(command).not.toContain('sudo -n -u');
  });

  it('treats all-missing bootstrap files as unusable context', () => {
    expect(hasUsableBootstrapContent([
      {
        name: 'README.md',
        path: '/home/mycc/workspace/0-System/about-me/README.md',
        missing: true,
      },
    ])).toBe(false);
    expect(hasUsableBootstrapContent([
      {
        name: 'README.md',
        path: '/home/mycc/workspace/0-System/about-me/README.md',
        content: 'hello',
        missing: false,
      },
    ])).toBe(true);
  });
});
