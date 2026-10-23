import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { heldGuestsForSlot, reservationHoldsSeats } from '../src/lib/reservationCapacity';
import type { ChatMessage, ChatService } from '../src/lib/chat';
import type { PublicSettingsDTO, ReservationDTO } from '../src/repositories/types';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

// ── Mega Audit #2, BE-M1 — slot capacity is enforced server-side ────
// Before this step the capacity existed only as a day-board DISPLAY:
// createReservationWithFee inserted unconditionally and the audit's
// probe held 60 guests against a 40 cap with three 201s. These suites
// rerun that probe as a test and pin the whole rule: the board's
// counting predicate, the exact-capacity boundary, both guest paths
// (form + Ember AI), the fee-at-creation nuance, and the admin path's
// deliberate exemption (staff warn, never block).

const DAY = dateFromToday(30);
const SLOT = '19:00';
const ADMIN = 'Bearer token-admin';

class FakeChatService implements ChatService {
  nextReply: string | null = null;
  async reply(): Promise<string> {
    const out = this.nextReply ?? 'Of course.';
    this.nextReply = null;
    return out;
  }
}

function buildApp(opts: { capacity?: number; withStripe?: boolean; fee?: boolean } = {}) {
  const repo = new FakeRepository();
  if (opts.capacity !== undefined || opts.fee) {
    repo.settings = {
      ...(repo.settings as PublicSettingsDTO),
      ...(opts.capacity !== undefined ? { reservationSlotCapacity: opts.capacity } : {}),
      ...(opts.fee ? { reservationFeeEnabled: true, reservationFeeAmount: 5 } : {}),
    };
  }
  const stripe = opts.withStripe ? new FakeStripeService() : null;
  const chat = new FakeChatService();
  const app = createApp({
    env: testEnv({ stripeConfigured: stripe != null, stripeSecretKey: stripe ? 'sk_test_fake' : null }),
    repo, verifyToken: fakeVerifyToken, stripe, chat,
  });
  return { repo, stripe, chat, app };
}

const book = (app: ReturnType<typeof createApp>, patch: Partial<{ date: string; time: string; guests: number; name: string }> = {}) =>
  request(app).post('/api/v1/reservations').send({
    name: patch.name ?? 'Capacity Guest', email: 'cap@example.com', phone: '+1 555 000 1234',
    date: patch.date ?? DAY, time: patch.time ?? SLOT, guests: patch.guests ?? 2,
  });

let seedSeq = 0;
/** A stored reservation row, seeded directly — the state the board counts from. */
function seed(repo: FakeRepository, patch: Partial<ReservationDTO> = {}): ReservationDTO {
  const row: ReservationDTO = {
    id: `seed-${++seedSeq}`, userId: null, name: 'Seeded Guest', email: 'seed@example.com',
    phone: '1234567', date: DAY, time: SLOT, guests: 10, source: 'website', notes: null,
    status: 'confirmed', feeAmount: null, feeCurrency: null, feePaymentStatus: 'none',
    createdAt: new Date().toISOString(), ...patch,
  };
  repo.reservations.push(row);
  return row;
}

// ---------------------------------------------------------------------
describe('the counting predicate — the day board rule, mirrored', () => {
  const base = { status: 'confirmed' as const, feeAmount: null, feePaymentStatus: 'none' as const };
  it('active free bookings hold seats; cancelled and completed hold nothing', () => {
    expect(reservationHoldsSeats({ ...base, status: 'pending' })).toBe(true);
    expect(reservationHoldsSeats({ ...base, status: 'confirmed' })).toBe(true);
    expect(reservationHoldsSeats({ ...base, status: 'cancelled' })).toBe(false);
    expect(reservationHoldsSeats({ ...base, status: 'completed' })).toBe(false);
  });
  it('a fee booking holds seats ONLY once its fee is paid', () => {
    expect(reservationHoldsSeats({ ...base, feeAmount: 5, feePaymentStatus: 'paid' })).toBe(true);
    expect(reservationHoldsSeats({ ...base, feeAmount: 5, feePaymentStatus: 'pending' })).toBe(false);
    expect(reservationHoldsSeats({ ...base, feeAmount: 5, feePaymentStatus: 'failed' })).toBe(false);
    expect(reservationHoldsSeats({ ...base, feeAmount: 5, feePaymentStatus: 'none' })).toBe(false);
  });
  it('heldGuestsForSlot sums only the seat-holding rows of that date+slot (HH:MM grouping)', () => {
    const rows: ReservationDTO[] = [
      seed(new FakeRepository(), { guests: 10 }),
      // Same slot stored with seconds — Postgres' HH:MM:SS form groups with HH:MM.
      seed(new FakeRepository(), { guests: 6, time: '19:00:00' }),
      seed(new FakeRepository(), { guests: 8, time: '20:00' }),
      seed(new FakeRepository(), { guests: 8, date: dateFromToday(31) }),
      seed(new FakeRepository(), { guests: 8, status: 'cancelled' }),
    ];
    expect(heldGuestsForSlot(rows, DAY, '19:00')).toBe(16);
    expect(heldGuestsForSlot(rows, DAY, '19:00:00')).toBe(16);
    expect(heldGuestsForSlot(rows, DAY, '20:00')).toBe(8);
  });
});

// ---------------------------------------------------------------------
describe('public form — capacity enforced (the audit probe, as a test)', () => {
  it('20 + 20 succeed against cap 40; the third 20 is refused 409 and creates NO row', async () => {
    const { repo, app } = buildApp();
    expect((await book(app, { guests: 20, name: 'Party One' })).status).toBe(201);
    expect((await book(app, { guests: 20, name: 'Party Two' })).status).toBe(201);
    const third = await book(app, { guests: 20, name: 'Party Three' });
    expect(third.status).toBe(409);
    expect(third.body.error).toBe('That time is fully booked — please choose a different time');
    expect(third.body.code).toBe('RESERVATION_SLOT_FULL');
    expect(repo.reservations).toHaveLength(2);
    expect(repo.reservations.reduce((s, r) => s + r.guests, 0)).toBe(40);
  });

  it('exactly at capacity succeeds; one guest over fails', async () => {
    const { repo, app } = buildApp();
    seed(repo, { guests: 39 });
    expect((await book(app, { guests: 1 })).status).toBe(201);
    const over = await book(app, { guests: 1, name: 'One Too Many' });
    expect(over.status).toBe(409);
    expect(repo.reservations).toHaveLength(2); // the seed + the exact-fit booking only
  });

  it('a different slot and a different day are unaffected by a full slot', async () => {
    const { repo, app } = buildApp();
    seed(repo, { guests: 40 });
    expect((await book(app, { guests: 20, time: '20:00' })).status).toBe(201);
    expect((await book(app, { guests: 20, date: dateFromToday(31) })).status).toBe(201);
    expect((await book(app, { guests: 1 })).status).toBe(409);
  });

  it('honours the configured capacity, not a hardcoded 40', async () => {
    const { repo, app } = buildApp({ capacity: 10 });
    expect((await book(app, { guests: 10 })).status).toBe(201);
    expect((await book(app, { guests: 1 })).status).toBe(409);
    expect(repo.reservations).toHaveLength(1);
  });

  it('cancelled, completed and unpaid-fee bookings in the slot consume NO capacity', async () => {
    const { repo, app } = buildApp();
    seed(repo, { guests: 20, status: 'cancelled' });
    seed(repo, { guests: 20, status: 'completed' });
    seed(repo, { guests: 20, feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'pending' });
    seed(repo, { guests: 20, feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'failed' });
    // 80 stored guests, ZERO held: the whole capacity is still open.
    expect((await book(app, { guests: 20 })).status).toBe(201);
    expect((await book(app, { guests: 20 })).status).toBe(201);
    expect((await book(app, { guests: 1 })).status).toBe(409);
    expect(repo.reservations).toHaveLength(6);
  });

  it('a PAID fee booking in the slot DOES consume capacity', async () => {
    const { repo, app } = buildApp();
    seed(repo, { guests: 40, feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'paid' });
    expect((await book(app, { guests: 1 })).status).toBe(409);
    expect(repo.reservations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
describe('fee in force — the incoming booking is counted prospectively', () => {
  it('a fee booking is refused when held seats leave no room — it is never sold a full slot', async () => {
    const { repo, stripe, app } = buildApp({ withStripe: true, fee: true });
    seed(repo, { guests: 40 });
    const res = await book(app, { guests: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESERVATION_SLOT_FULL');
    expect(repo.reservations).toHaveLength(1); // seed only — no row, so no intent either
    expect(stripe?.intents.size).toBe(0);
  });

  it('a fee booking that fits is created exactly as before (row + intent + feePayment shape)', async () => {
    const { repo, app } = buildApp({ withStripe: true, fee: true });
    seed(repo, { guests: 38 });
    const res = await book(app, { guests: 2 });
    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({ feeAmount: 5, feePaymentStatus: 'pending', guests: 2 });
    expect(res.body.feePayment).toMatchObject({ amount: 5, currency: 'USD' });
    expect(repo.reservations).toHaveLength(2);
  });

  it('existing UNPAID fee bookings do not block a new booking (board rule, both directions)', async () => {
    const { repo, app } = buildApp({ withStripe: true, fee: true });
    // A full slot's worth of unpaid fee bookings holds nothing yet…
    seed(repo, { guests: 40, feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'pending' });
    // …so a new booking still fits against the HELD count of zero.
    expect((await book(app, { guests: 20 })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------
describe('Ember AI — a full slot is answered honestly, never booked', () => {
  const marker = (patch: Partial<{ date: string; time: string; guests: string }> = {}) =>
    `[[BOOK: ${patch.date ?? DAY} | ${patch.time ?? SLOT} | ${patch.guests ?? '4'} | Ayesha Khan | +92 300 1234567 | ayesha@example.com]]`;
  const ask = (app: ReturnType<typeof createApp>, chat: FakeChatService, reply: string) => {
    chat.nextReply = reply;
    return request(app).post('/api/v1/chat').send({ messages: [{ role: 'user', content: 'Yes please, go ahead' }] } as { messages: ChatMessage[] });
  };

  it('over capacity: no row is created and the reply says the slot is fully booked', async () => {
    const { repo, chat, app } = buildApp();
    seed(repo, { guests: 40 });
    const res = await ask(app, chat, `Arranging that for you now. ${marker()}`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeNull();
    expect(repo.reservations).toHaveLength(1); // the seed only
    expect(res.body.reply).toContain('fully booked');
    expect(res.body.reply).toContain('no table has been reserved');
    // The honest-full note, NOT the generic failure note and never a confirmation:
    expect(res.body.reply).not.toContain('something on our side kept the booking from completing');
    expect(res.body.reply).not.toContain('is reserved, and your reference is');
    expect(res.body.reply).not.toContain('[[');
  });

  it('exactly at capacity still books through chat, with the server confirmation', async () => {
    const { repo, chat, app } = buildApp();
    seed(repo, { guests: 36 });
    const res = await ask(app, chat, `Arranging that for you now. ${marker({ guests: '4' })}`);
    expect(res.status).toBe(200);
    expect(repo.reservations).toHaveLength(2);
    expect(res.body.booking).toMatchObject({ guests: 4, status: 'pending' });
    expect(res.body.reply).toContain('is reserved, and your reference is');
  });
});

// ---------------------------------------------------------------------
describe('admin path — warn-not-block is preserved', () => {
  it('an admin (walk-in) booking still creates OVER capacity — the admin route never enters the shared flow', async () => {
    const { repo, app } = buildApp();
    seed(repo, { guests: 40 }); // slot held completely full
    const res = await request(app).post('/api/v1/admin/reservations')
      .set('Authorization', ADMIN)
      .send({ name: 'Walk-in Guest', phone: '+1 555 111 2222', date: DAY, time: SLOT, guests: 20, status: 'confirmed' });
    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({ source: 'admin', guests: 20, status: 'confirmed' });
    expect(repo.reservations).toHaveLength(2);
  });
});
