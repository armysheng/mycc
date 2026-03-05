import { randomUUID } from 'node:crypto';

const DEFAULT_TICKET_TTL_MS = 15 * 60 * 1000;

export type OnboardingBootstrapTicket = {
  userId: number;
  assistantName: string;
  ownerName: string;
  token: string;
  expiresAt: number;
};

const ticketStore = new Map<string, OnboardingBootstrapTicket>();

function getKey(userId: number, token: string): string {
  return `${userId}:${token}`;
}

export function issueOnboardingBootstrapTicket(params: {
  userId: number;
  assistantName: string;
  ownerName: string;
  ttlMs?: number;
}): OnboardingBootstrapTicket {
  const token = randomUUID();
  const expiresAt = Date.now() + (params.ttlMs ?? DEFAULT_TICKET_TTL_MS);
  const ticket: OnboardingBootstrapTicket = {
    userId: params.userId,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    token,
    expiresAt,
  };
  ticketStore.set(getKey(params.userId, token), ticket);
  return ticket;
}

export function consumeOnboardingBootstrapTicket(params: {
  userId: number;
  token: string;
  assistantName: string;
  ownerName: string;
}): { ok: true } | { ok: false; reason: string } {
  const key = getKey(params.userId, params.token);
  const ticket = ticketStore.get(key);
  if (!ticket) return { ok: false, reason: 'ticket_not_found' };

  if (ticket.expiresAt <= Date.now()) {
    ticketStore.delete(key);
    return { ok: false, reason: 'ticket_expired' };
  }
  if (ticket.assistantName !== params.assistantName || ticket.ownerName !== params.ownerName) {
    return { ok: false, reason: 'ticket_payload_mismatch' };
  }

  ticketStore.delete(key);
  return { ok: true };
}

export function clearExpiredOnboardingBootstrapTickets(nowMs: number = Date.now()): void {
  for (const [key, ticket] of ticketStore.entries()) {
    if (ticket.expiresAt <= nowMs) {
      ticketStore.delete(key);
    }
  }
}

export function __resetOnboardingBootstrapTicketStoreForTests(): void {
  ticketStore.clear();
}
