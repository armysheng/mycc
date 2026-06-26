import type { User } from '../db/client.js';

export function makeTestUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? 42;
  return {
    id,
    phone: undefined,
    email: `user-${id}@example.test`,
    password_hash: 'hash',
    assistant_name: '小麦',
    linux_user: id === 42 ? 'tester' : 'other',
    status: 'active',
    is_initialized: true,
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeTestUserLookup(overrides: Partial<User> = {}) {
  return async (userId: number): Promise<User> => makeTestUser({
    id: userId,
    ...overrides,
  });
}
