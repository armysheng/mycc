import { describe, expect, it } from 'vitest';
import {
  __resetOnboardingBootstrapTicketStoreForTests,
  consumeOnboardingBootstrapTicket,
  issueOnboardingBootstrapTicket,
} from './bootstrap-ticket-store.js';

describe('bootstrap-ticket-store', () => {
  it('consumes valid ticket once', () => {
    __resetOnboardingBootstrapTicketStoreForTests();
    const ticket = issueOnboardingBootstrapTicket({
      userId: 101,
      assistantName: '韩立',
      ownerName: '元婴',
      ttlMs: 10_000,
    });

    expect(consumeOnboardingBootstrapTicket({
      userId: 101,
      token: ticket.token,
      assistantName: '韩立',
      ownerName: '元婴',
    })).toEqual({ ok: true });

    expect(consumeOnboardingBootstrapTicket({
      userId: 101,
      token: ticket.token,
      assistantName: '韩立',
      ownerName: '元婴',
    })).toEqual({ ok: false, reason: 'ticket_not_found' });
  });

  it('rejects mismatched payload', () => {
    __resetOnboardingBootstrapTicketStoreForTests();
    const ticket = issueOnboardingBootstrapTicket({
      userId: 102,
      assistantName: '韩立',
      ownerName: '元婴',
      ttlMs: 10_000,
    });

    expect(consumeOnboardingBootstrapTicket({
      userId: 102,
      token: ticket.token,
      assistantName: '韩立',
      ownerName: '道友',
    })).toEqual({ ok: false, reason: 'ticket_payload_mismatch' });
  });
});
