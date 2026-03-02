import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindMainSession,
  clearMainSession,
  getSoulState,
  injectSoulMemory,
  loadOrCreateSoulProfile,
  readSoulMemory,
  resolveChatSession,
  writeSoulMemory,
} from './session-soul.js';

describe('session-soul', () => {
  const originalSoulDir = process.env.CHAT_SOUL_DIR;
  const originalDMScope = process.env.CHAT_DM_SCOPE;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-soul-'));
    process.env.CHAT_SOUL_DIR = tempDir;
    process.env.CHAT_DM_SCOPE = 'main';
  });

  afterEach(async () => {
    process.env.CHAT_SOUL_DIR = originalSoulDir;
    process.env.CHAT_DM_SCOPE = originalDMScope;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates and persists profile as file state', async () => {
    const first = await loadOrCreateSoulProfile(1001);
    const second = await loadOrCreateSoulProfile(1001);

    expect(first.identityId).toBe('u-1001');
    expect(first.soulId).toBeTruthy();
    expect(second.soulId).toBe(first.soulId);
  });

  it('binds first session as main and reuses it when sessionId is absent', async () => {
    await bindMainSession(1002, 'session-main-a');
    await bindMainSession(1002, 'session-main-b');

    const resolved = await resolveChatSession(1002, undefined);
    expect(resolved.effectiveSessionId).toBe('session-main-a');
  });

  it('keeps request scope isolated without implicit session merge', async () => {
    process.env.CHAT_DM_SCOPE = 'request';
    await bindMainSession(1003, 'session-main-a');

    const resolved = await resolveChatSession(1003, undefined);
    expect(resolved.effectiveSessionId).toBeUndefined();
    expect(resolved.dmScope).toBe('request');
  });

  it('clears stale main session when requested', async () => {
    await bindMainSession(1006, 'session-main-a');
    await clearMainSession(1006);

    const resolved = await resolveChatSession(1006, undefined);
    expect(resolved.effectiveSessionId).toBeUndefined();
  });

  it('writes and reads memory file, then injects memory into message', async () => {
    await writeSoulMemory(1004, '用户偏好：回答要先给结论。');
    const memory = await readSoulMemory(1004);
    const merged = injectSoulMemory('帮我总结今天进展', memory);

    expect(memory).toContain('用户偏好');
    expect(merged).toContain('<SOUL_MEMORY>');
    expect(merged).toContain('帮我总结今天进展');
  });

  it('returns identity state for API exposure', async () => {
    const state = await getSoulState(1005);
    expect(state.profile.identityId).toBe('u-1005');
    expect(state.hasMemory).toBe(false);
    expect(state.memoryChars).toBe(0);
    expect(state.dmScope).toBe('main');
  });
});
