import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryIdeSessionStore } from '../ide/session-store.js';
import { createSkillsService } from './index.js';

const skillEventMocks = vi.hoisted(() => ({
  getSkillStatsMap: vi.fn(),
  recordSkillEvent: vi.fn(),
}));

vi.mock('./skill-events.js', () => ({
  getSkillStatsMap: skillEventMocks.getSkillStatsMap,
  recordSkillEvent: skillEventMocks.recordSkillEvent,
}));

describe('createSkillsService E2B integration', () => {
  beforeEach(() => {
    skillEventMocks.getSkillStatsMap.mockReset();
    skillEventMocks.recordSkillEvent.mockReset();
    skillEventMocks.getSkillStatsMap.mockResolvedValue(new Map());
    skillEventMocks.recordSkillEvent.mockResolvedValue(undefined);
  });

  it('installs catalog skills through the reusable E2B session runner when workspace mode is E2B', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_skill',
      codeServerPid: 1234,
      host: '18080-sbx_skill.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-06-01T00:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockImplementation(async (_session, command: string) => {
      if (command.includes('MYCC_WORKSPACE_TEMPLATE_SEED')) {
        return ok('seeded');
      }
      if (command.includes('/opt/mycc/skills') && command.includes('echo')) {
        return ok('/opt/mycc/skills\n');
      }
      if (command.includes('/home/mycc/.claude/skills/pdf/SKILL.md')) {
        return ok('---\nversion: 1.0.0\n---\n');
      }
      return ok('');
    });

    const service = createSkillsService({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      } as NodeJS.ProcessEnv,
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: sessionStore,
    });

    const result = await service.subscribeSkill({
      userId: 42,
      linuxUser: 'mycc_u42',
    }, 'pdf');

    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx_skill', userId: 42 }),
      expect.stringContaining('/opt/mycc/skills'),
      expect.objectContaining({ cwd: '/home/mycc/workspace' }),
    );
    expect(result).toEqual({
      skillId: 'pdf',
      installed: true,
      version: '1.0.0',
      source: 'catalog',
      targetPath: '/home/mycc/.claude/skills/pdf',
    });
  });

  it('lists E2B skills without auto-seeding builtins during the read path', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_skill_list',
      codeServerPid: 1234,
      host: '18080-sbx_skill_list.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-06-01T00:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockImplementation(async (_session, command: string) => {
      if (command.includes('MYCC_WORKSPACE_TEMPLATE_SEED')) {
        return ok('seeded');
      }
      if (command.includes('/opt/mycc/skills') && command.includes('echo')) {
        return ok('/opt/mycc/skills\n');
      }
      if (command.includes('.mycc-manifest.json')) {
        return ok('{"skills":{"pdf":{"version":"1.0.0","source":"catalog","disabled":false}}}');
      }
      if (command.includes("find '/home/mycc/.claude/skills'")) {
        return ok('/home/mycc/.claude/skills/pdf/SKILL.md\n');
      }
      if (command.includes("find '/opt/mycc/skills'")) {
        return ok('/opt/mycc/skills/pdf/SKILL.md\n/opt/mycc/skills/browser-use/SKILL.md\n');
      }
      if (command.includes('/opt/mycc/skills/pdf/SKILL.md')) {
        return ok('---\nversion: 1.0.0\n---\n');
      }
      if (command.includes('/opt/mycc/skills/browser-use')) {
        return ok('ok\n');
      }
      return ok('');
    });

    const service = createSkillsService({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      } as NodeJS.ProcessEnv,
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: sessionStore,
    });

    const result = await service.listSkills({
      userId: 42,
      linuxUser: 'mycc_u42',
    });

    expect(result.skills.find((skill) => skill.id === 'pdf')).toMatchObject({
      id: 'pdf',
      installed: true,
      status: 'installed',
    });
    expect(runCommandInSession.mock.calls.some(([, command]) => String(command).includes('cp -a'))).toBe(false);
  });

  it('reports the E2B template Claude skills path in skill details', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_skill_detail',
      codeServerPid: 1234,
      host: '18080-sbx_skill_detail.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-06-01T00:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockImplementation(async (_session, command: string) => {
      if (command.includes('MYCC_WORKSPACE_TEMPLATE_SEED')) {
        return ok('seeded');
      }
      if (command.includes('/opt/mycc/skills') && command.includes('echo')) {
        return ok('/opt/mycc/skills\n');
      }
      if (command.includes('.mycc-manifest.json')) {
        return ok('{"skills":{"pdf":{"version":"1.0.0","source":"catalog","disabled":false}}}');
      }
      if (command.includes("find '/home/mycc/.claude/skills'")) {
        return ok('/home/mycc/.claude/skills/pdf/SKILL.md\n');
      }
      if (command.includes("find '/opt/mycc/skills'")) {
        return ok('/opt/mycc/skills/pdf/SKILL.md\n');
      }
      if (command.includes('/opt/mycc/skills/pdf/SKILL.md')) {
        return ok('---\nversion: 1.0.0\n---\n');
      }
      return ok('');
    });

    const service = createSkillsService({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      } as NodeJS.ProcessEnv,
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: sessionStore,
    });

    const detail = await service.getSkillDetail({
      userId: 42,
      linuxUser: 'mycc_u42',
    }, 'pdf');

    expect(detail.installTargetPath).toBe('/home/mycc/.claude/skills/pdf');
  });
});

function ok(stdout: string) {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
  };
}
