export type AuthResult = {
  token: string;
  user: {
    id: number;
    email?: string;
    phone?: string;
    is_initialized?: boolean;
  };
};

type JsonObject = Record<string, unknown>;

export function readAuthResult(body: JsonObject): AuthResult {
  const data = body.data;
  if (!isObject(data)) throw new Error('auth response missing data');

  const token = data.token;
  const user = data.user;
  if (typeof token !== 'string' || !isObject(user)) {
    throw new Error('auth response missing token or user');
  }

  const id = user.id;
  if (typeof id !== 'number') {
    throw new Error('auth response user is incomplete');
  }

  return {
    token,
    user: {
      id,
      email: typeof user.email === 'string' ? user.email : undefined,
      phone: typeof user.phone === 'string' ? user.phone : undefined,
      is_initialized: typeof user.is_initialized === 'boolean' ? user.is_initialized : undefined,
    },
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
