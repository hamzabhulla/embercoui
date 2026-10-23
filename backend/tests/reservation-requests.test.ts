import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { ReservationDTO } from '../src/repositories/types';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';

// Phase G — customer "Your Reservations" + change requests, over the
// fake repository: the visibility rule (account-linked OR guest-email
// match, enforced server-side), request creation (validation, the
// one-pending guard, ownership with no existence leak), the admin
// Requests inbox and its capability gates, the Apply save approving
// in the same operation, decline/handled, the Change History rows,
// and the pre-0015 degradation.

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const asUser = (r: request.Test) => r.set('Authorization', 'Bearer token-user');
const asUser2 = (r: request.Test) => r.set('Authorization', 'Bearer token-user2');
const asAdmin = (r: request.Test) => r.set('Authorization', 'Bearer token-admin');
const asStaff = (r: request.Test) => r.set('Authorization', 'Bearer token-staff');
const asManager = (r: request.Test) => r.set('Authorization', 'Bearer token-manager');

let seedSeq = 0;
function seedReservation(over: Partial<ReservationDTO> = {}): ReservationDTO {
  const r: ReservationDTO = {
    id: `res-seed-${++seedSeq}`, userId: null, name: 'Seed Guest', email: null,
    phone: '+1 555 000 1111', date: dateFromToday(30), time: '19:00', guests: 2,
    source: 'website', notes: null, status: 'confirmed',
    feeAmount: null, feeCurrency: null, feePaymentStatus: 'none',
    createdAt: new Date().toISOString(), ...over,
  };
  repo.reservations.push(r);
  return r;
}

const myReservations = async (as: (r: request.Test) => request.Test) => {
  const res = await as(request(app).get('/api/v1/account/reservations'));
  expect(res.status).toBe(200);
  return res.body as {
    reservations: (ReservationDTO & { requests: { id: string; status: string; adminReply: string | null }[] })[];
    requestsDegraded: boolean;
  };
};

describe('account reservations — visibility', () => {
  it('shows bookings linked to the account and guest bookings matching the account email (case-insensitive)', async () => {
    const linked = seedReservation({ userId: 'user-1', name: 'Linked Booking' });
    const guestMatch = seedReservation({ userId: null, email: 'USER@EXAMPLE.COM', name: 'Guest Match' });
    seedReservation({ userId: 'user-2', email: 'user2@example.com', name: 'Someone Elses' });
    seedReservation({ userId: null, email: 'stranger@example.com', name: 'Other Guest' });
    seedReservation({ userId: null, email: null, name: 'Walk-in No Email' });

    const { reservations, requestsDegraded } = await myReservations(asUser);
    const ids = reservations.map((r) => r.id);
    expect(ids).toContain(linked.id);
    expect(ids).toContain(guestMatch.id);
    expect(ids).toHaveLength(2);
    expect(requestsDegraded).toBe(false);
    // The other account sees exactly its own booking.
    const other = await myReservations(asUser2);
    expect(other.reservations.map((r) => r.name)).toEqual(['Someone Elses']);
  });

  it('401s anonymously', async () => {
    expect((await request(app).get('/api/v1/account/reservations')).status).toBe(401);
  });

  it('sorts upcoming first (soonest first), then the past most-recent first', async () => {
    const repo2 = new FakeRepository();
    const app2 = createApp({ env: testEnv(), repo: repo2, verifyToken: fakeVerifyToken });
    const mk = (date: string, name: string) => {
      repo2.reservations.push({
        id: `r-${name}`, userId: 'user-1', name, email: null, phone: 'p', date, time: '19:00',
        guests: 2, source: 'website', notes: null, status: 'confirmed',
        feeAmount: null, feeCurrency: null, feePaymentStatus: 'none', createdAt: '2026-01-01T00:00:00Z',
      });
    };
    mk(dateFromToday(-2), 'past-recent');
    mk(dateFromToday(10), 'upcoming-later');
    mk(dateFromToday(-20), 'past-older');
    mk(dateFromToday(3), 'upcoming-sooner');
    const res = await asUser(request(app2).get('/api/v1/account/reservations'));
    expect(res.body.reservations.map((r: { name: string }) => r.name))
      .toEqual(['upcoming-sooner', 'upcoming-later', 'past-recent', 'past-older']);
  });

  it('carries the Phase F fee state when the booking has one', async () => {
    seedReservation({ userId: 'user-1', name: 'Fee Booking', feeAmount: 15, feeCurrency: 'USD', feePaymentStatus: 'paid' });
    const { reservations } = await myReservations(asUser);
    const fee = reservations.find((r) => r.name === 'Fee Booking');
    expect(fee).toMatchObject({ feeAmount: 15, feeCurrency: 'USD', feePaymentStatus: 'paid' });
  });
});

describe('change requests — creation', () => {
  it('creates a request with a proposal + note and logs it (without the note body)', async () => {
    const booking = seedReservation({ userId: 'user-1', date: dateFromToday(30), time: '19:00', guests: 2 });
    const res = await asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({
      proposedDate: dateFromToday(35), proposedGuests: 5, message: 'A quiet corner, please — anniversary.',
    });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({
      reservationId: booking.id, requesterUserId: 'user-1', requesterEmail: 'user@example.com',
      proposedDate: dateFromToday(35), proposedTime: null, proposedGuests: 5,
      message: 'A quiet corner, please — anniversary.', status: 'pending', adminReply: null,
    });
    const rows = repo.auditEvents.filter((e) => e.action === 'reservation_request.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: 'user-1', entity: 'reservation_request', entityId: res.body.request.id });
    expect(rows[0].changes).toMatchObject({
      reservation: { from: null, to: booking.id },
      date: { from: booking.date, to: dateFromToday(35) },
      guests: { from: 2, to: 5 },
      messageAttached: { from: false, to: true },
    });
    // The note body itself never lands in the log.
    expect(JSON.stringify(rows[0])).not.toContain('anniversary');
    // And it reads back on the customer's own list.
    const { reservations } = await myReservations(asUser);
    const mine = reservations.find((r) => r.id === booking.id);
    expect(mine?.requests).toHaveLength(1);
    expect(mine?.requests[0].status).toBe('pending');
  });

  it('accepts a message-only request and a proposal-only request', async () => {
    const a = seedReservation({ userId: 'user-1' });
    const b = seedReservation({ userId: 'user-1' });
    expect((await asUser(request(app).post(`/api/v1/account/reservations/${a.id}/requests`)).send({ message: 'Running late — keep the table.' })).status).toBe(201);
    expect((await asUser(request(app).post(`/api/v1/account/reservations/${b.id}/requests`)).send({ proposedTime: '20:30' })).status).toBe(201);
  });

  it('lets the owner of a guest booking (email match) request a change', async () => {
    const guest = seedReservation({ userId: null, email: 'user@example.com' });
    const res = await asUser(request(app).post(`/api/v1/account/reservations/${guest.id}/requests`)).send({ proposedGuests: 3 });
    expect(res.status).toBe(201);
  });

  it('rejects invalid proposals with the reservation form rules', async () => {
    const booking = seedReservation({ userId: 'user-1' });
    const post = (body: Record<string, unknown>) =>
      asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send(body);
    expect((await post({ proposedDate: dateFromToday(-1) })).status).toBe(400);
    expect((await post({ proposedDate: '2027-02-30' })).status).toBe(400);
    expect((await post({ proposedDate: 'next Friday' })).status).toBe(400);
    expect((await post({ proposedTime: '25:00' })).status).toBe(400);
    expect((await post({ proposedTime: '7pm' })).status).toBe(400);
    expect((await post({ proposedGuests: 0 })).status).toBe(400);
    expect((await post({ proposedGuests: 21 })).status).toBe(400);
    expect((await post({ proposedGuests: 2.5 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ message: '   ' })).status).toBe(400);
    expect((await post({ message: 'x'.repeat(1001) })).status).toBe(400);
    // None of the rejected attempts left a request behind.
    expect(repo.reservationRequests.filter((q) => q.reservationId === booking.id)).toHaveLength(0);
  });

  it('answers another customer’s booking exactly like a missing one (404, no leak)', async () => {
    const theirs = seedReservation({ userId: 'user-2', email: 'user2@example.com' });
    const guestTheirs = seedReservation({ userId: null, email: 'someone-else@example.com' });
    for (const id of [theirs.id, guestTheirs.id, 'res-does-not-exist']) {
      const res = await asUser(request(app).post(`/api/v1/account/reservations/${id}/requests`)).send({ proposedGuests: 3 });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Reservation not found');
    }
    expect(repo.reservationRequests.filter((q) => [theirs.id, guestTheirs.id].includes(q.reservationId))).toHaveLength(0);
    expect((await request(app).post(`/api/v1/account/reservations/${theirs.id}/requests`).send({ proposedGuests: 3 })).status).toBe(401);
  });

  it('allows at most one pending request per reservation (409), and a fresh one after handling', async () => {
    const booking = seedReservation({ userId: 'user-1' });
    const post = () => asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({ message: 'Note' });
    expect((await post()).status).toBe(201);
    const second = await post();
    expect(second.status).toBe(409);
    const pending = repo.reservationRequests.find((q) => q.reservationId === booking.id);
    const declined = await asAdmin(request(app).post(`/api/v1/admin/reservation-requests/${pending!.id}/decline`)).send({ reply: 'Fully booked that evening.' });
    expect(declined.status).toBe(200);
    expect((await post()).status).toBe(201);
  });

  it('refuses a request on a cancelled or completed reservation (409) and persists nothing', async () => {
    // The account page only offers the form on pending/confirmed
    // bookings; the API mirrors it (final deep audit L1).
    const cancelled = seedReservation({ userId: 'user-1', status: 'cancelled' });
    const completed = seedReservation({ userId: 'user-1', status: 'completed' });
    const createdBefore = repo.auditEvents.filter((e) => e.action === 'reservation_request.created').length;
    for (const booking of [cancelled, completed]) {
      const res = await asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({ proposedGuests: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('no longer active');
    }
    expect(repo.reservationRequests.filter((q) => [cancelled.id, completed.id].includes(q.reservationId))).toHaveLength(0);
    expect(repo.auditEvents.filter((e) => e.action === 'reservation_request.created')).toHaveLength(createdBefore);
  });

  it('a request made while the booking was live stays handleable after the booking is cancelled', async () => {
    // The state gate is on CREATION only: an admin may still answer
    // a pending request whose booking has since closed.
    const booking = seedReservation({ userId: 'user-1', status: 'confirmed' });
    const created = await asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({ message: 'Running late.' });
    expect(created.status).toBe(201);
    booking.status = 'cancelled';
    const declined = await asAdmin(request(app).post(`/api/v1/admin/reservation-requests/${created.body.request.id}/decline`)).send({ reply: 'Understood — booking cancelled.' });
    expect(declined.status).toBe(200);
    expect(declined.body.request.status).toBe('declined');
  });
});

describe('admin inbox + handling', () => {
  async function seedRequest() {
    const booking = seedReservation({ userId: 'user-1', name: 'Inbox Guest', date: dateFromToday(30), time: '19:00', guests: 2 });
    const res = await asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({
      proposedDate: dateFromToday(32), proposedTime: '20:00', proposedGuests: 6,
      message: 'Bigger table if possible.',
    });
    expect(res.status).toBe(201);
    return { booking, requestId: res.body.request.id as string };
  }

  it('lists requests with their reservation context and the exact pending total', async () => {
    const { booking, requestId } = await seedRequest();
    const res = await asAdmin(request(app).get('/api/v1/admin/reservation-requests'));
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(false);
    const row = (res.body.requests as { id: string }[]).find((x) => x.id === requestId) as Record<string, unknown>;
    expect(row).toMatchObject({
      status: 'pending', proposedGuests: 6, requesterEmail: 'user@example.com',
      reservation: { id: booking.id, name: 'Inbox Guest', date: booking.date, guests: 2 },
    });
    expect(res.body.pendingTotal).toBe(repo.reservationRequests.filter((q) => q.status === 'pending').length);
    // Customers never reach the admin surface; anonymous neither.
    expect((await asUser(request(app).get('/api/v1/admin/reservation-requests'))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/reservation-requests')).status).toBe(401);
  });

  it('filters by status and 400s an unknown status', async () => {
    const { requestId } = await seedRequest();
    await asAdmin(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/handled`)).send({});
    const handled = await asManager(request(app).get('/api/v1/admin/reservation-requests?status=handled'));
    expect(handled.status).toBe(200);
    expect((handled.body.requests as { id: string }[]).map((x) => x.id)).toContain(requestId);
    const pending = await asManager(request(app).get('/api/v1/admin/reservation-requests?status=pending'));
    expect((pending.body.requests as { id: string }[]).map((x) => x.id)).not.toContain(requestId);
    expect((await asManager(request(app).get('/api/v1/admin/reservation-requests?status=bogus'))).status).toBe(400);
  });

  it('Apply: the reservation edit carrying the request id approves it in the same save', async () => {
    const { booking, requestId } = await seedRequest();
    // Capture the pre-edit values: the fake (like any in-place store)
    // mutates the seeded object, so reading booking.date afterwards
    // would read the NEW date.
    const originalDate = booking.date;
    const res = await asAdmin(request(app).patch(`/api/v1/admin/reservations/${booking.id}`)).send({
      date: dateFromToday(32), time: '20:00', guests: 6, requestId, reply: 'Done — see you then.',
    });
    expect(res.status).toBe(200);
    expect(res.body.reservation).toMatchObject({ date: dateFromToday(32), time: '20:00', guests: 6 });
    expect(res.body.request).toMatchObject({ id: requestId, status: 'approved', adminReply: 'Done — see you then.', handledBy: 'admin-1' });
    // Both steps land in Change History with the handling admin as actor.
    const updated = repo.auditEvents.filter((e) => e.action === 'reservation.updated' && e.entityId === booking.id);
    expect(updated.at(-1)?.changes).toMatchObject({
      date: { from: originalDate, to: dateFromToday(32) }, guests: { from: 2, to: 6 },
    });
    const approved = repo.auditEvents.filter((e) => e.action === 'reservation_request.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ actorId: 'admin-1', entityId: requestId });
    expect(approved[0].changes).toMatchObject({
      reservation: { from: null, to: booking.id }, status: { from: 'pending', to: 'approved' },
      replyGiven: { from: false, to: true },
    });
    // The customer reads the outcome back.
    const { reservations } = await myReservations(asUser);
    const mine = reservations.find((r) => r.id === booking.id);
    expect(mine?.date).toBe(dateFromToday(32));
    expect(mine?.requests[0]).toMatchObject({ status: 'approved', adminReply: 'Done — see you then.' });
  });

  it('Apply without saving approves nothing: reads leave the request pending, and an edit without the id does too', async () => {
    const { booking, requestId } = await seedRequest();
    await asAdmin(request(app).get('/api/v1/admin/reservation-requests'));
    await asAdmin(request(app).get(`/api/v1/admin/reservations?date=${booking.date}`));
    expect(repo.reservationRequests.find((q) => q.id === requestId)?.status).toBe('pending');
    const edit = await asAdmin(request(app).patch(`/api/v1/admin/reservations/${booking.id}`)).send({ guests: 3 });
    expect(edit.status).toBe(200);
    expect(edit.body.request).toBeUndefined();
    expect(repo.reservationRequests.find((q) => q.id === requestId)?.status).toBe('pending');
  });

  it('Apply refuses a foreign or already-handled request id, and an edit must change something', async () => {
    const a = await seedRequest();
    const b = await seedRequest();
    const foreign = await asAdmin(request(app).patch(`/api/v1/admin/reservations/${a.booking.id}`)).send({ guests: 4, requestId: b.requestId });
    expect(foreign.status).toBe(400);
    expect(repo.reservations.find((r) => r.id === a.booking.id)?.guests).toBe(2);
    await asAdmin(request(app).post(`/api/v1/admin/reservation-requests/${b.requestId}/handled`)).send({});
    const stale = await asAdmin(request(app).patch(`/api/v1/admin/reservations/${b.booking.id}`)).send({ guests: 4, requestId: b.requestId });
    expect(stale.status).toBe(409);
    expect((await asAdmin(request(app).patch(`/api/v1/admin/reservations/${a.booking.id}`)).send({})).status).toBe(400);
    expect((await asAdmin(request(app).patch('/api/v1/admin/reservations/nope')).send({ guests: 4 })).status).toBe(404);
    expect((await asAdmin(request(app).patch(`/api/v1/admin/reservations/${a.booking.id}`)).send({ date: dateFromToday(-3) })).status).toBe(400);
  });

  it('decline requires a reply, stores it, and the customer sees it; a closed request cannot be closed again', async () => {
    const { booking, requestId } = await seedRequest();
    expect((await asManager(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/decline`)).send({})).status).toBe(400);
    expect((await asManager(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/decline`)).send({ reply: '  ' })).status).toBe(400);
    const res = await asManager(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/decline`)).send({ reply: 'That evening is fully booked — the next night is open.' });
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ status: 'declined', adminReply: 'That evening is fully booked — the next night is open.', handledBy: 'manager-1' });
    const rows = repo.auditEvents.filter((e) => e.action === 'reservation_request.declined' && e.entityId === requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: 'manager-1', entityId: requestId });
    expect(rows[0].changes).toMatchObject({ status: { from: 'pending', to: 'declined' }, replyGiven: { from: false, to: true } });
    expect(JSON.stringify(rows[0])).not.toContain('fully booked — the next night');
    // Customer read-back.
    const { reservations } = await myReservations(asUser);
    const mine = reservations.find((r) => r.id === booking.id);
    expect(mine?.requests[0]).toMatchObject({ status: 'declined', adminReply: 'That evening is fully booked — the next night is open.' });
    // Second close attempt is a conflict, not a rewrite.
    expect((await asManager(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/handled`)).send({})).status).toBe(409);
    expect((await asManager(request(app).post('/api/v1/admin/reservation-requests/nope/decline')).send({ reply: 'x' })).status).toBe(404);
  });

  it('mark handled works with or without a reply and logs whether one was given', async () => {
    const a = await seedRequest();
    const res = await asStaff(request(app).post(`/api/v1/admin/reservation-requests/${a.requestId}/handled`)).send({});
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ status: 'handled', adminReply: null, handledBy: 'staff-1' });
    const rows = repo.auditEvents.filter((e) => e.action === 'reservation_request.handled' && e.entityId === a.requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toMatchObject({ replyGiven: { from: false, to: false } });
  });

  it('a view-only reservations holder can read the inbox but cannot handle or edit', async () => {
    const { booking, requestId } = await seedRequest();
    const staffProfile = repo.profiles.get('staff-1');
    staffProfile!.permissions = { reservations: 'view' };
    try {
      expect((await asStaff(request(app).get('/api/v1/admin/reservation-requests'))).status).toBe(200);
      expect((await asStaff(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/decline`)).send({ reply: 'No' })).status).toBe(403);
      expect((await asStaff(request(app).post(`/api/v1/admin/reservation-requests/${requestId}/handled`)).send({})).status).toBe(403);
      expect((await asStaff(request(app).patch(`/api/v1/admin/reservations/${booking.id}`)).send({ guests: 4, requestId })).status).toBe(403);
      expect(repo.reservationRequests.find((q) => q.id === requestId)?.status).toBe('pending');
    } finally {
      staffProfile!.permissions = null;
    }
  });
});

describe('pre-0015 degradation', () => {
  it('the account list still works, creation answers an honest 503, and the inbox reports degraded', async () => {
    const booking = seedReservation({ userId: 'user-1', name: 'Pre Migration Booking' });
    repo.reservationRequestsAvailable = false;
    try {
      const { reservations, requestsDegraded } = await myReservations(asUser);
      const mine = reservations.find((r) => r.id === booking.id);
      expect(mine?.name).toBe('Pre Migration Booking');
      expect(mine?.requests).toEqual([]);
      expect(requestsDegraded).toBe(true);

      const create = await asUser(request(app).post(`/api/v1/account/reservations/${booking.id}/requests`)).send({ proposedGuests: 4 });
      expect(create.status).toBe(503);

      const inbox = await asAdmin(request(app).get('/api/v1/admin/reservation-requests'));
      expect(inbox.status).toBe(200);
      expect(inbox.body).toMatchObject({ requests: [], total: 0, pendingTotal: 0, degraded: true });

      const decline = await asAdmin(request(app).post('/api/v1/admin/reservation-requests/whatever/decline')).send({ reply: 'x' });
      expect(decline.status).toBe(404);
    } finally {
      repo.reservationRequestsAvailable = true;
    }
  });
});
