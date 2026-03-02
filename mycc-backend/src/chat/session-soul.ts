import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PROFILE_VERSION = 1;
const PROFILE_FILENAME = 'profile.json';
const MEMORY_FILENAME = 'MEMORY.md';
const MAX_MEMORY_CHARS = 8000;

export type DMScope = 'main' | 'request';

export interface SoulProfile {
  version: number;
  userId: number;
  identityId: string;
  soulId: string;
  mainSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoulState {
  profile: SoulProfile;
  hasMemory: boolean;
  memoryChars: number;
  memoryPath: string;
  dmScope: DMScope;
}

export interface ResolvedSession {
  profile: SoulProfile;
  requestedSessionId?: string;
  effectiveSessionId?: string;
  dmScope: DMScope;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getSoulRootDir(): string {
  const configured = process.env.CHAT_SOUL_DIR?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), 'runtime', 'chat-soul');
}

function getUserSoulDir(userId: number): string {
  return path.join(getSoulRootDir(), `user-${userId}`);
}

function getProfilePath(userId: number): string {
  return path.join(getUserSoulDir(userId), PROFILE_FILENAME);
}

function getMemoryPath(userId: number): string {
  return path.join(getUserSoulDir(userId), MEMORY_FILENAME);
}

function parseDMScope(raw: string | undefined): DMScope {
  return raw?.toLowerCase() === 'request' ? 'request' : 'main';
}

function getDMScope(): DMScope {
  return parseDMScope(process.env.CHAT_DM_SCOPE);
}

async function ensureUserSoulDir(userId: number): Promise<void> {
  await fs.mkdir(getUserSoulDir(userId), { recursive: true });
}

function createProfile(userId: number): SoulProfile {
  const timestamp = nowIso();
  return {
    version: PROFILE_VERSION,
    userId,
    identityId: `u-${userId}`,
    soulId: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function isSoulProfile(value: unknown): value is SoulProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.version === 'number' &&
    typeof profile.userId === 'number' &&
    typeof profile.identityId === 'string' &&
    typeof profile.soulId === 'string' &&
    typeof profile.createdAt === 'string' &&
    typeof profile.updatedAt === 'string' &&
    (profile.mainSessionId === undefined || typeof profile.mainSessionId === 'string')
  );
}

async function saveProfile(profile: SoulProfile): Promise<void> {
  const profilePath = getProfilePath(profile.userId);
  await ensureUserSoulDir(profile.userId);
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
}

export async function loadOrCreateSoulProfile(userId: number): Promise<SoulProfile> {
  const profilePath = getProfilePath(userId);

  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isSoulProfile(parsed)) {
      return parsed;
    }
  } catch {
    // ignore and create a new profile
  }

  const profile = createProfile(userId);
  await saveProfile(profile);
  return profile;
}

export async function resolveChatSession(
  userId: number,
  requestedSessionId?: string,
): Promise<ResolvedSession> {
  const profile = await loadOrCreateSoulProfile(userId);
  const dmScope = getDMScope();
  const requested = requestedSessionId?.trim();

  if (requested) {
    return {
      profile,
      requestedSessionId: requested,
      effectiveSessionId: requested,
      dmScope,
    };
  }

  if (dmScope === 'main' && profile.mainSessionId) {
    return {
      profile,
      effectiveSessionId: profile.mainSessionId,
      dmScope,
    };
  }

  return {
    profile,
    dmScope,
  };
}

export async function bindMainSession(userId: number, sessionId?: string): Promise<void> {
  const normalized = sessionId?.trim();
  if (!normalized || getDMScope() !== 'main') return;

  const profile = await loadOrCreateSoulProfile(userId);
  if (profile.mainSessionId) return;

  profile.mainSessionId = normalized;
  profile.updatedAt = nowIso();
  await saveProfile(profile);
}

export async function clearMainSession(userId: number): Promise<void> {
  const profile = await loadOrCreateSoulProfile(userId);
  if (!profile.mainSessionId) return;

  delete profile.mainSessionId;
  profile.updatedAt = nowIso();
  await saveProfile(profile);
}

export async function readSoulMemory(userId: number): Promise<string> {
  try {
    const raw = await fs.readFile(getMemoryPath(userId), 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return '';
    return trimmed.slice(0, MAX_MEMORY_CHARS);
  } catch {
    return '';
  }
}

export function injectSoulMemory(message: string, memory: string): string {
  const memoryBlock = memory.trim();
  if (!memoryBlock) return message;

  return [
    '请在回复时参考以下长期记忆（如与当前指令冲突，以当前指令为准）：',
    '<SOUL_MEMORY>',
    memoryBlock,
    '</SOUL_MEMORY>',
    '',
    '用户当前请求：',
    message,
  ].join('\n');
}

export async function writeSoulMemory(userId: number, content: string): Promise<void> {
  await ensureUserSoulDir(userId);
  const normalized = content.trim();
  const finalContent = normalized ? `${normalized}\n` : '';
  await fs.writeFile(getMemoryPath(userId), finalContent, 'utf8');

  const profile = await loadOrCreateSoulProfile(userId);
  profile.updatedAt = nowIso();
  await saveProfile(profile);
}

export async function getSoulState(userId: number): Promise<SoulState> {
  const profile = await loadOrCreateSoulProfile(userId);
  const memory = await readSoulMemory(userId);
  return {
    profile,
    hasMemory: memory.length > 0,
    memoryChars: memory.length,
    memoryPath: getMemoryPath(userId),
    dmScope: getDMScope(),
  };
}
