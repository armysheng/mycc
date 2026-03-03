import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSoulState,
  injectSoulMemory,
  loadOrCreateSoulProfile,
  readSoulMemory,
  writeSoulMemory,
} from './session-soul.js';

describe('session-soul', () => {
  const originalSoulDir = process.env.CHAT_SOUL_DIR;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-soul-'));
    process.env.CHAT_SOUL_DIR = tempDir;
  });

  afterEach(async () => {
    process.env.CHAT_SOUL_DIR = originalSoulDir;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates and persists profile as file state', async () => {
    const first = await loadOrCreateSoulProfile(1001);
    const second = await loadOrCreateSoulProfile(1001);

    expect(first.identityId).toBe('u-1001');
    expect(first.soulId).toBeTruthy();
    expect(second.soulId).toBe(first.soulId);
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
  });
});
