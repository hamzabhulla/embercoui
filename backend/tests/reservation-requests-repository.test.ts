import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G — the REAL Supabase repository's reservation-request
// surface, pinned against the shared PostgREST miniature
// (./stubSupabase): the account visibility query (linked OR
// case-insensitive email match, de-duplicated, upcoming-first), the
// one-pending guard, the conditional close, the inbox join + exact
// pending total, and above all the PRE-0015 behaviour — until the
// owner runs migration 0015 the table does not exist and every read
// degrades honestly instead of failing.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository, isMissingReservationRequestsError } from '../src/repositories/supabaseRepository';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();
const rows = (table: string): Row[] => stub.tables.get(table) ?? [];
const dayFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function reservationRow(id: string, patch: Row = {}): Row {
  return {
    id, user_id: null, name: `Guest ${id}`, email: null, phone: '+1 555 000 1111',
    reservation_date: dayFromToday(30), reservation_time: '19:00:00', guests: 2,
    status: 'confirmed', source: 'website', notes: null, created_at: ts(1), ...patch,
  };
}
function requestRow(id: string, reservationId: string, patch: Row = {}): Row {
  return {
    id, reservation_id: reservationId, requester_user_id: 'user-1', requester_email: 'user@example.com',
    proposed_date: null, proposed_time: null, proposed_guests: null, message: '',
    status: 'pending', admin_reply: null, handled_by: null,
    created_at: ts(5), updated_at: ts(5), ...patch,
  };
}

beforeEach(() => stub.reset());

describe('listReservationsForUser — visibility + order', () => {
  it('returns linked and email-matching bookings once each, upcoming first, and nothing of anyone else’s', async () => {
    stub.seed('reservations', [
      reservationRow('r-linked', { user_id: 'user-1', email: 'user@example.com', reservation_date: dayFromToday(10) }),
      reservationRow('r-guest', { user_id: null, email: 'USER@EXAMPLE.COM', reservation_date: dayFromToday(5) }),
      reservationRow('r-past', { user_id: 'user-1', reservation_date: dayFromToday(-4) }),
      reservationRow('r-other-user', { user_id: 'user-2', email: 'user2@example.com' }),
      reservationRow('r-other-guest', { user_id: null, email: 'stranger@example.com' }),
      reservationRow('r-walkin', { user_id: null, email: null }),
    ]);
    const { reservations, requests } = await repo.listReservationsForUser('user-1', 'user@example.com');
    expect(reservations.map((r) => r.id)).toEqual(['r-guest', 'r-linked', 'r-past']);
    expect(requests).toEqual([]);
  });

  it('an empty account email skips the email read entirely', async () => {
    stub.seed('reservations', [reservationRow('r-guest', { user_id: null, email: 'user@example.com' })]);
    const { reservations } = await repo.listReservationsForUser('user-1', null);
    expect(reservations).toEqual([]);
  });

  it('attaches the bookings’ requests newest first, with DTO coercion of a stored odd status', async () => {
    stub.seed('reservations', [reservationRow('r-1', { user_id: 'user-1' })]);
    stub.seed('reservation_requests', [
      requestRow('q-old', 'r-1', { created_at: ts(10), status: 'declined', admin_reply: 'No room that night.' }),
      requestRow('q-new', 'r-1', { created_at: ts(20), status: 'mystery' }),
      requestRow('q-foreign', 'r-2', { created_at: ts(30) }),
    ]);
    const { requests } = await repo.listReservationsForUser('user-1', null);
    expect(requests?.map((q) => q.id)).toEqual(['q-new', 'q-old']);
    expect(requests?.[0].status).toBe('pending');
    expect(requests?.[1]).toMatchObject({ status: 'declined', adminReply: 'No room that night.' });
  });
});

describe('createReservationRequest — guard + degradation', () => {
  const input = {
    reservationId: 'r-1', requesterUserId: 'user-1', requesterEmail: 'user@example.com',
    proposedDate: null, proposedTime: null, proposedGuests: 4, message: 'Note',
  };

  it('inserts the snake_case row and reads it back as a pending DTO', async () => {
    const created = await repo.createReservationRequest(input);
    expect(created).toMatchObject({ reservationId: 'r-1', proposedGuests: 4, message: 'Note', status: 'pending', adminReply: null });
    expect(rows('reservation_requests')).toHaveLength(1);
    expect(rows('reservation_requests')[0]).toMatchObject({
      reservation_id: 'r-1', requester_user_id: 'user-1', proposed_guests: 4,
    });
  });

  it('a second pending request for the same booking is a 409; a handled one frees the slot', async () => {
    await repo.createReservationRequest(input);
    await expect(repo.createReservationRequest(input)).rejects.toMatchObject({ status: 409 });
    const pending = await repo.getReservationRequest(rows('reservation_requests')[0].id as string);
    await repo.updateReservationRequest(pending!.id, { status: 'handled', handledBy: 'admin-1' });
    await expect(repo.createReservationRequest(input)).resolves.toMatchObject({ status: 'pending' });
  });

  it('PRE-0015: creation resolves null — never a throw, never a fake row', async () => {
    stub.setMissingColumns('reservation_requests', ['reservation_id']);
    await expect(repo.createReservationRequest(input)).resolves.toBeNull();
    expect(rows('reservation_requests')).toHaveLength(0);
  });
});

describe('adminListReservationRequests — inbox join, totals, degradation', () => {
  it('joins the reservation context and reports exact totals per filter', async () => {
    stub.seed('reservations', [reservationRow('r-1'), reservationRow('r-2')]);
    stub.seed('reservation_requests', [
      requestRow('q-1', 'r-1', { created_at: ts(10) }),
      requestRow('q-2', 'r-2', { created_at: ts(20), status: 'declined', admin_reply: 'Full.' }),
      requestRow('q-3', 'r-1', { created_at: ts(30) }),
    ]);
    const all = await repo.adminListReservationRequests({}, { limit: 100, offset: 0 });
    expect(all.degraded).toBe(false);
    expect(all.total).toBe(3);
    expect(all.pendingTotal).toBe(2);
    expect(all.items.map((i) => i.id)).toEqual(['q-3', 'q-2', 'q-1']);
    expect(all.items[0].reservation?.id).toBe('r-1');
    expect(all.items[1]).toMatchObject({ status: 'declined', adminReply: 'Full.' });
    const declined = await repo.adminListReservationRequests({ status: 'declined' }, { limit: 100, offset: 0 });
    expect(declined.total).toBe(1);
    expect(declined.pendingTotal).toBe(2);
    const page2 = await repo.adminListReservationRequests({}, { limit: 2, offset: 2 });
    expect(page2.items.map((i) => i.id)).toEqual(['q-1']);
    expect(page2.total).toBe(3);
  });

  it('PRE-0015: an empty page flagged degraded', async () => {
    stub.setMissingColumns('reservation_requests', ['status']);
    await expect(repo.adminListReservationRequests({}, { limit: 100, offset: 0 }))
      .resolves.toEqual({ items: [], total: 0, pendingTotal: 0, degraded: true });
  });
});

describe('updateReservationRequest / getReservationRequest — the conditional close', () => {
  it('closes a pending request exactly once; a repeat and an unknown id resolve null', async () => {
    stub.seed('reservation_requests', [requestRow('q-1', 'r-1')]);
    const closed = await repo.updateReservationRequest('q-1', { status: 'declined', adminReply: 'Full.', handledBy: 'admin-1' });
    expect(closed).toMatchObject({ status: 'declined', adminReply: 'Full.', handledBy: 'admin-1' });
    expect(rows('reservation_requests')[0]).toMatchObject({ status: 'declined', admin_reply: 'Full.', handled_by: 'admin-1' });
    await expect(repo.updateReservationRequest('q-1', { status: 'handled', handledBy: 'admin-1' })).resolves.toBeNull();
    await expect(repo.updateReservationRequest('ghost', { status: 'handled', handledBy: 'admin-1' })).resolves.toBeNull();
    await expect(repo.updateReservationRequest('not-a-uuid', { status: 'handled', handledBy: 'admin-1' })).resolves.toBeNull();
    await expect(repo.getReservationRequest('not-a-uuid')).resolves.toBeNull();
    await expect(repo.getReservationRequest('ghost')).resolves.toBeNull();
  });

  it('PRE-0015: the close resolves null and the read resolves null', async () => {
    stub.seed('reservation_requests', [requestRow('q-1', 'r-1')]);
    // 'status' is in the update payload (PGRST204); 'id' is the
    // read's filter column (42703) — together they are the stub's
    // missing-table simulation for both shapes of call.
    stub.setMissingColumns('reservation_requests', ['status', 'id']);
    await expect(repo.updateReservationRequest('q-1', { status: 'handled', handledBy: 'admin-1' })).resolves.toBeNull();
    await expect(repo.getReservationRequest('q-1')).resolves.toBeNull();
  });
});

describe('adminUpdateReservation — the Apply edit', () => {
  it('patches only the fields given; unknown and malformed ids resolve null', async () => {
    stub.seed('reservations', [reservationRow('r-1', { guests: 2 })]);
    const updated = await repo.adminUpdateReservation('r-1', { guests: 6 });
    expect(updated).toMatchObject({ guests: 6, date: dayFromToday(30), time: '19:00:00' });
    expect(rows('reservations')[0]).toMatchObject({ guests: 6 });
    await expect(repo.adminUpdateReservation('ghost', { guests: 3 })).resolves.toBeNull();
    await expect(repo.adminUpdateReservation('not-a-uuid', { guests: 3 })).resolves.toBeNull();
    // An empty patch is a read of the booking as it stands.
    await expect(repo.adminUpdateReservation('r-1', {})).resolves.toMatchObject({ id: 'r-1', guests: 6 });
  });
});

describe('pre-0015 list degradation + error classifier', () => {
  it('the reservations list degrades to requests=null while the bookings read normally', async () => {
    stub.seed('reservations', [reservationRow('r-1', { user_id: 'user-1' })]);
    stub.setMissingColumns('reservation_requests', ['reservation_id']);
    const { reservations, requests } = await repo.listReservationsForUser('user-1', null);
    expect(reservations.map((r) => r.id)).toEqual(['r-1']);
    expect(requests).toBeNull();
  });

  it('classifies the missing-table signals and nothing else', () => {
    expect(isMissingReservationRequestsError({ code: 'PGRST205', message: 'nope' })).toBe(true);
    expect(isMissingReservationRequestsError({ code: '42P01', message: 'nope' })).toBe(true);
    expect(isMissingReservationRequestsError({ code: '42703', message: 'nope' })).toBe(true);
    expect(isMissingReservationRequestsError({ message: 'relation "public.reservation_requests" does not exist' })).toBe(true);
    expect(isMissingReservationRequestsError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingReservationRequestsError(null)).toBe(false);
    expect(isMissingReservationRequestsError(undefined)).toBe(false);
  });
});
