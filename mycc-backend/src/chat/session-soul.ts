import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PROFILE_VERSION = 1;
const PROFILE_FILENAME = 'profile.json';
const MEMORY_FILENAME = 'MEMORY.md';
const MAX_MEMORY_CHARS = 8000;

export interface SoulProfile {
  version: number;
  userId: number;
  identityId: string;
  soulId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoulState {
  profile: SoulProfile;
  hasMemory: boolean;
  memoryChars: number;
  memoryPath: string;
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
    typeof profile.updatedAt === 'string'
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

export function injectSoulContext(message: string, profile: SoulProfile, memory: string): string {
  const parts: string[] = [
    '你正在服务同一位用户，请保持人格与偏好连续性。',
    `<SOUL_IDENTITY user_id="${profile.userId}" identity_id="${profile.identityId}" soul_id="${profile.soulId}" />`,
  ];
  const memoryBlock = memory.trim();
  if (memoryBlock) {
    parts.push(
      '<SOUL_MEMORY>',
      memoryBlock,
      '</SOUL_MEMORY>',
    );
  }
  parts.push(
    '',
    '用户当前请求：',
    message,
  );
  return parts.join('\n');
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

function buildOnboardingMemory(assistantName: string, ownerName: string): string {
  return [
    '角色与称呼偏好：',
    `- 你的名字是：${assistantName}`,
    `- 对用户的称呼：${ownerName}`,
    '- 回复优先保持简洁、先结论后细节。',
  ].join('\n');
}

/**
 * 首次 onboarding 时种下 soul 记忆。
 * 仅在 memory 为空时写入，避免覆盖用户后续手动沉淀的长期记忆。
 */
export async function seedSoulMemoryFromOnboarding(
  userId: number,
  assistantName: string,
  ownerName: string,
): Promise<{ seeded: boolean }> {
  await loadOrCreateSoulProfile(userId);
  const existing = await readSoulMemory(userId);
  if (existing.trim()) {
    return { seeded: false };
  }

  await writeSoulMemory(userId, buildOnboardingMemory(assistantName.trim(), ownerName.trim()));
  return { seeded: true };
}

export async function getSoulState(userId: number): Promise<SoulState> {
  const profile = await loadOrCreateSoulProfile(userId);
  const memory = await readSoulMemory(userId);
  return {
    profile,
    hasMemory: memory.length > 0,
    memoryChars: memory.length,
    memoryPath: getMemoryPath(userId),
  };
}
