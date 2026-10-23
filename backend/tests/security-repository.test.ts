import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase C — the REAL Supabase repository's Security & Activity read
// (listAuditEvents), pinned against the shared PostgREST miniature
// (./stubSupabase): filter translation (the category as LIKE / NOT
// LIKE on the action prefix, the action prefix match with wildcards
// escaped, the free-text or() of ILIKEs), filtered totals, and above
// all the PRE-0012 degradation — a missing audit_events table answers
// an empty page flagged `degraded`, never a throw.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository } from '../src/repositories/supabaseRepository';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();

function auditRow(id: string, patch: Row = {}): Row {
  return {
    id, actor_id: 'admin-1', actor_label: 'Admin', actor_role: 'admin',
    action: 'staff.role_changed', entity: 'profile', entity_id: 'p-1',
    summary: 'Role changed', changes: { role: { from: 'customer', to: 'staff' } },
    ip: '203.0.113.9', user_agent: 'test-agent', created_at: ts(1), ...patch,
  };
}

function seedEvents() {
  stub.seed('audit_events', [
    auditRow('e-1', { action: 'auth.login', entity: 'session', entity_id: null, summary: 'Admin sign-in', changes: null, created_at: ts(10) }),
    auditRow('e-2', { action: 'auth.login_failed', actor_id: null, actor_label: 'intruder@example.com', actor_role: null, entity: null, entity_id: null, summary: 'Failed admin sign-in attempt (client report — unverified)', changes: null, created_at: ts(20) }),
    auditRow('e-3', { action: 'menu_item.updated', actor_id: 'staff-1', actor_label: 'Staff', actor_role: 'staff', entity: 'menu_item', entity_id: '1', summary: 'Menu item "Ember Classic" updated', changes: { price: { from: 24, to: 26 } }, created_at: ts(30) }),
    auditRow('e-4', { action: 'coupon.created', entity: 'coupon', entity_id: 'cpn-9', summary: 'Coupon HARVEST15 created', changes: { code: { from: null, to: 'HARVEST15' } }, created_at: ts(40) }),
  ]);
}

beforeEach(() => stub.reset());

describe('listAuditEvents: mapping + order + totals', () => {
  it('maps snake_case rows to DTOs, newest first, with the exact total', async () => {
    seedEvents();
    const page = await repo.listAuditEvents({}, { limit: 2, offset: 0 });
    expect(page.degraded).toBe(false);
    expect(page.total).toBe(4);
    expect(page.items.map((e) => e.id)).toEqual(['e-4', 'e-3']);
    expect(page.items[0]).toMatchObject({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin',
      action: 'coupon.created', entity: 'coupon', entityId: 'cpn-9',
      ip: '203.0.113.9', userAgent: 'test-agent', createdAt: ts(40),
    });
    const rest = await repo.listAuditEvents({}, { limit: 2, offset: 2 });
    expect(rest.items.map((e) => e.id)).toEqual(['e-2', 'e-1']);
  });

  it('the unpaged call returns the complete filtered set (the CSV read)', async () => {
    seedEvents();
    const all = await repo.listAuditEvents({ category: 'change' });
    expect(all.total).toBe(2);
    expect(all.items.map((e) => e.id)).toEqual(['e-4', 'e-3']);
  });
});

describe('listAuditEvents: filter translation', () => {
  it("category 'auth' selects the auth. prefix; 'change' excludes it", async () => {
    seedEvents();
    const auth = await repo.listAuditEvents({ category: 'auth' }, { limit: 100, offset: 0 });
    expect(auth.items.map((e) => e.action).sort()).toEqual(['auth.login', 'auth.login_failed']);
    const change = await repo.listAuditEvents({ category: 'change' }, { limit: 100, offset: 0 });
    expect(change.items.map((e) => e.action).sort()).toEqual(['coupon.created', 'menu_item.updated']);
  });

  it('action is a prefix match, and LIKE wildcards in the value match literally', async () => {
    seedEvents();
    const family = await repo.listAuditEvents({ action: 'menu_item.' }, { limit: 100, offset: 0 });
    expect(family.items.map((e) => e.id)).toEqual(['e-3']);
    // '%' in the filter value must NOT act as a wildcard: no action
    // literally starts with 'auth%', so nothing matches.
    const literal = await repo.listAuditEvents({ action: 'auth%' }, { limit: 100, offset: 0 });
    expect(literal.total).toBe(0);
  });

  it('actorId, date range and free text all narrow the set', async () => {
    seedEvents();
    expect((await repo.listAuditEvents({ actorId: 'staff-1' }, { limit: 100, offset: 0 })).items.map((e) => e.id)).toEqual(['e-3']);
    const ranged = await repo.listAuditEvents({ from: ts(15), to: ts(35) }, { limit: 100, offset: 0 });
    expect(ranged.items.map((e) => e.id)).toEqual(['e-3', 'e-2']);
    // q matches the summary (HARVEST15), the actor label and the action.
    expect((await repo.listAuditEvents({ q: 'harvest15' }, { limit: 100, offset: 0 })).items.map((e) => e.id)).toEqual(['e-4']);
    expect((await repo.listAuditEvents({ q: 'intruder@' }, { limit: 100, offset: 0 })).items.map((e) => e.id)).toEqual(['e-2']);
    expect((await repo.listAuditEvents({ q: 'menu_item' }, { limit: 100, offset: 0 })).items.map((e) => e.id)).toEqual(['e-3']);
  });
});

describe('listAuditEvents: q wildcards match literally', () => {
  function seedWildcardEvents() {
    stub.seed('audit_events', [
      auditRow('w-1', { action: 'settings.updated', entity: 'settings', summary: 'Discount set to 100% today', created_at: ts(10) }),
      auditRow('w-2', { action: 'settings.updated', entity: 'settings', summary: 'Key a_b saved', created_at: ts(20) }),
      auditRow('w-3', { action: 'settings.updated', entity: 'settings', summary: 'Key axb saved', created_at: ts(30) }),
      auditRow('w-4', { action: 'auth.login', actor_label: 'under_score', entity: 'session', entity_id: null, summary: 'Sign-in', changes: null, created_at: ts(40) }),
    ]);
  }

  it("q='_' matches only rows containing a literal underscore", async () => {
    seedWildcardEvents();
    // w-2 (summary 'a_b') and w-4 (actor label 'under_score'), newest
    // first. With _ acting as a one-character wildcard, every seeded
    // row would match.
    const page = await repo.listAuditEvents({ q: '_' }, { limit: 100, offset: 0 });
    expect(page.items.map((e) => e.id)).toEqual(['w-4', 'w-2']);
  });

  it("q='a_b' matches the literal 'a_b' and does NOT match 'axb'", async () => {
    seedWildcardEvents();
    const page = await repo.listAuditEvents({ q: 'a_b' }, { limit: 100, offset: 0 });
    expect(page.items.map((e) => e.id)).toEqual(['w-2']);
  });

  it("q='%' matches only rows containing a literal '%' (it is escaped, not stripped)", async () => {
    seedWildcardEvents();
    const page = await repo.listAuditEvents({ q: '%' }, { limit: 100, offset: 0 });
    expect(page.items.map((e) => e.id)).toEqual(['w-1']);
    const mixed = await repo.listAuditEvents({ q: '100%' }, { limit: 100, offset: 0 });
    expect(mixed.items.map((e) => e.id)).toEqual(['w-1']);
  });

  it('a q made only of stripped or()-grammar characters matches nothing — never the unfiltered page', async () => {
    seedWildcardEvents();
    const page = await repo.listAuditEvents({ q: '",()"' }, { limit: 100, offset: 0 });
    expect(page).toEqual({ items: [], total: 0, degraded: false });
    // The unpaged (CSV) read inherits the same answer.
    const all = await repo.listAuditEvents({ q: '",()"' });
    expect(all).toEqual({ items: [], total: 0, degraded: false });
  });
});

describe('listAuditEvents: degradation + malformed filters', () => {
  it('PRE-0012: with the audit table missing from the schema, the read degrades to an empty flagged page', async () => {
    seedEvents();
    stub.setMissingColumns('audit_events', ['action']);
    const page = await repo.listAuditEvents({ category: 'auth' }, { limit: 100, offset: 0 });
    expect(page).toEqual({ items: [], total: 0, degraded: true });
  });

  it('a non-UUID actorId filter matches no one instead of throwing (22P02 → empty page)', async () => {
    seedEvents();
    const page = await repo.listAuditEvents({ actorId: 'not-a-uuid' }, { limit: 100, offset: 0 });
    expect(page).toEqual({ items: [], total: 0, degraded: false });
  });
});
