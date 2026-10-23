import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { OrderDTO, ProfileDTO, Repository, ReservationDTO } from '../repositories/types';
import { ApiError, notConfigured } from '../lib/errors';
import type { TokenVerifier } from '../lib/auth';
import {
  bookingConfirmationNote, bookingDetailsNeededNote, bookingFeePendingNote, bookingUnavailableNote,
  buildChatSystemPrompt, extractBookingMarker, resolveCartActions, resolveCartSnapshot, summarizeOrderForChat, summarizeReservationDay,
  type ChatMessage, type ChatOrderSummary, type ChatService, type ReservationDayAvailability,
} from '../lib/chat';
import { effectiveReservationFee } from '../lib/reservationFee';
import type { StripeService } from '../lib/stripe';
import { createReservationWithFee, reservationSchema, type ReservationFeePayment } from './forms';
import { validateBody } from '../middleware/validate';

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1, 'Message cannot be empty').max(1000, 'Message is too long'),
      })
    )
    .min(1, 'At least one message is required')
    .max(20, 'Conversation is too long'),
  // The visitor's cart as ids + quantities ONLY — names and prices are
  // never accepted from the client; the server resolves them against
  // the live menu (resolveCartSnapshot), exactly as orders re-price.
  cart: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .max(50)
    .optional(),
});

type CartEntry = { menuItemId: number; quantity: number };

/**
 * Today's and tomorrow's seat picture (UTC days, the backend's usual
 * convention) for the prompt: complete per-date sets, aggregated to
 * slot totals. A nicety, never a dependency — ANY failure returns null
 * and the chat answers exactly as it did without the section.
 */
async function fetchReservationAvailability(
  repo: Repository,
  capacity: number,
): Promise<ReservationDayAvailability[] | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const [todayRows, tomorrowRows] = await Promise.all([
      repo.adminListReservations({ date: today }),
      repo.adminListReservations({ date: tomorrow }),
    ]);
    return [
      summarizeReservationDay(today, 'Today', todayRows, capacity),
      summarizeReservationDay(tomorrow, 'Tomorrow', tomorrowRows, capacity),
    ];
  } catch {
    return null;
  }
}

/** The visitor behind a chat request, when their session token verifies. */
interface ChatUser {
  id: string;
  /** From the real profile row; null when there is none (or it cannot be read) — null is never staff. */
  role: ProfileDTO['role'] | null;
}

/**
 * Chat-local optional user resolution. The frontend's apiRequest already
 * attaches the session's Bearer token to every call, chat included — this
 * merely READS it. Deliberately more forgiving than optionalAuth: that
 * middleware surfaces a 503 when the verifier itself fails (the right
 * call for order routes), but a chat must never die because the auth
 * service hiccupped. Here EVERY failure — no token, invalid or expired
 * token, verifier outage, unreadable profile — simply means "anonymous
 * chat": still 200, still grounded, just without the orders context.
 */
async function resolveChatUser(
  req: Request,
  deps: { repo: Repository; verifyToken?: TokenVerifier },
): Promise<ChatUser | null> {
  if (!deps.verifyToken) return null;
  const header = req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const verified = await deps.verifyToken(token);
    if (!verified) return null;
    const profile = await deps.repo.getProfile(verified.id).catch(() => null);
    return { id: verified.id, role: profile?.role ?? null };
  } catch {
    return null;
  }
}

/**
 * The orders route's visibility rule (GET /orders/:id), mirrored exactly
 * — never weakened: a guest order (no account) is visible to anyone
 * holding its unguessable id; an account order only to its owner or to
 * staff/admin. Anything else is treated as "not found", so the chat
 * never leaks that an order exists.
 */
function orderVisibleTo(order: OrderDTO, user: ChatUser | null): boolean {
  if (!order.userId) return true;
  if (!user) return false;
  return user.id === order.userId || user.role === 'admin' || user.role === 'staff' || user.role === 'manager';
}

/**
 * What the route learned about the signed-in visitor's orders:
 * - 'orders' — the fetch succeeded and there are orders to show;
 * - 'none' — the fetch SUCCEEDED and the visitor has none yet: a fact
 *   the prompt may state outright. Only an empty success earns this —
 *   claiming "no orders" on a failed fetch would be a lie of exactly
 *   the kind this chat is grounded against;
 * - 'unavailable' — anonymous, or the fetch failed: no section, no
 *   claims, exactly the pre-order-awareness behaviour.
 */
type RecentOrdersOutcome =
  | { kind: 'orders'; orders: ChatOrderSummary[] }
  | { kind: 'none' }
  | { kind: 'unavailable' };

/** The signed-in visitor's latest 3 orders, newest first. Best-effort: any failure → 'unavailable', chat unaffected. */
async function fetchRecentOrders(repo: Repository, user: ChatUser | null): Promise<RecentOrdersOutcome> {
  if (!user) return { kind: 'unavailable' };
  try {
    const orders = await repo.listOrdersForUser(user.id);
    if (!orders.length) return { kind: 'none' };
    return {
      kind: 'orders',
      orders: [...orders]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
          || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(0, 3)
        .map(summarizeOrderForChat),
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

const ORDER_ID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;

/**
 * The order behind an id pasted into the latest user message — the
 * visitor quoting their confirmation code. Only the FIRST UUID-shaped
 * token of that one message is looked up. Not found and not-yours are
 * indistinguishable (both → null, nothing injected, no error): the
 * prompt's standing rule handles the conversation without confirming
 * or denying the order exists.
 */
async function fetchFocusOrder(
  repo: Repository,
  user: ChatUser | null,
  cleanMessages: ChatMessage[],
): Promise<ChatOrderSummary | null> {
  const lastUser = cleanMessages[cleanMessages.length - 1];
  const match = lastUser?.role === 'user' ? lastUser.content.match(ORDER_ID_PATTERN) : null;
  if (!match) return null;
  try {
    const order = await repo.getOrder(match[0]);
    return order && orderVisibleTo(order, user) ? summarizeOrderForChat(order) : null;
  } catch {
    return null;
  }
}

/** What executing a chat booking produced: the server-written note, and the created booking's summary (null when nothing was created). */
interface ChatBookingOutcome {
  note: string;
  booking: {
    id: string;
    date: string;
    time: string;
    guests: number;
    status: ReservationDTO['status'];
    feePaymentStatus: ReservationDTO['feePaymentStatus'];
    /**
     * The fee's card step for THIS booking only — the same
     * ReservationFeePayment handle the form route returns — present
     * only when the creation flow minted an intent for the booking
     * this very response created; absent for a free booking, exactly
     * as the form route omits it. It exists so the widget can render
     * the card step in the conversation; it is never attached to any
     * other reservation.
     */
    feePayment?: ReservationFeePayment;
  } | null;
}

/**
 * Executes ONE booking the model requested in its reply: the fields
 * are validated against the ONE reservation schema (routes/forms.ts)
 * and created through the ONE creation flow (createReservationWithFee)
 * — a chat booking is a website booking in every rule that touches it:
 * same validation, same fee semantics, same repository write, source
 * 'website'. The outcome is always a server-written note — the
 * confirmation (or the fee still owed) on success, the honest failure
 * wording otherwise. A booking attempt NEVER fails the chat itself.
 */
async function executeChatBooking(
  deps: { repo: Repository; stripe: StripeService | null },
  userId: string | null,
  request: { date: string; time: string; guests: string; name: string; phone: string; email: string },
): Promise<ChatBookingOutcome> {
  const parsed = reservationSchema.safeParse({
    name: request.name,
    email: request.email,
    phone: request.phone,
    date: request.date,
    time: request.time,
    guests: request.guests,
  });
  if (!parsed.success) {
    return {
      note: bookingDetailsNeededNote(parsed.error.issues.map((i) => String(i.path[0] ?? ''))),
      booking: null,
    };
  }
  try {
    const created = await createReservationWithFee(
      { repo: deps.repo, stripe: deps.stripe },
      {
        userId,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        date: parsed.data.date,
        time: parsed.data.time,
        guests: parsed.data.guests,
      },
    );
    const r = created.reservation;
    return {
      note: created.feePayment
        ? bookingFeePendingNote(r, { amount: created.feePayment.amount, currency: created.feePayment.currency })
        : bookingConfirmationNote(r),
      booking: {
        id: r.id, date: r.date, time: r.time, guests: r.guests,
        status: r.status, feePaymentStatus: r.feePaymentStatus,
        // The fee handle rides along only when the flow created one
        // for this booking — the widget's card step keys off it.
        ...(created.feePayment ? { feePayment: created.feePayment } : {}),
      },
    };
  } catch (err) {
    // The booking could not be completed (provider, store, or the
    // creation flow's 409 race): the guest hears the honest note, the
    // operator hears the cause — the same logged-not-swallowed
    // posture as the fee compensation.
    console.error('[ember] chat booking failed:', err instanceof Error ? err.message : err);
    return { note: bookingUnavailableNote(), booking: null };
  }
}

export function chatRouter(deps: { repo: Repository | null; chat: ChatService | null; verifyToken?: TokenVerifier; rateLimitMax?: number; stripeConfigured?: boolean; stripe?: StripeService | null }) {
  const router = Router();
  // Stricter than the global limiter: every message spends API money.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: deps.rateLimitMax ?? 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'You are sending messages too quickly — please wait a few minutes.' },
  });

  router.post('/chat', limiter, validateBody(chatBodySchema), async (req, res, next) => {
    try {
      if (!deps.chat) throw new ApiError(503, 'Ember AI is not available right now.');
      if (!deps.repo) throw notConfigured();
      const { messages, cart } = req.body as { messages: ChatMessage[]; cart?: CartEntry[] };
      if (messages[messages.length - 1].role !== 'user') {
        throw new ApiError(400, 'The last message must be from the user.');
      }
      // Client-supplied history is untrusted: a visitor can put anything
      // in an "assistant" message — including forged [[ADD: …]] markers
      // or claims that a discount was approved. Strip every [[...]] span
      // before the history reaches the model; markers are only ever
      // honoured in the model's OWN reply (resolveCartActions reads the
      // reply text, never the history). Messages left empty by stripping
      // drop out, and the slice bounds what reaches the model even if
      // the schema cap above is ever relaxed.
      const cleanMessages = messages
        .map((m) => ({ role: m.role, content: m.content.replace(/\[\[[^\]]*\]\]/g, '').trim() }))
        .filter((m) => m.content.length > 0)
        .slice(-20);
      if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== 'user') {
        throw new ApiError(400, 'The last message must be from the user.');
      }
      const [settings, items] = await Promise.all([deps.repo.getSettings(), deps.repo.listMenuItems()]);
      // Live context for the concierge: the visitor's cart resolved
      // against the menu just fetched, and today/tomorrow's seat
      // picture. Both are best-effort grounding — neither can fail the
      // chat (resolveCartSnapshot is pure; availability degrades to an
      // omitted section).
      const cartSnapshot = resolveCartSnapshot(cart, items, settings.currency);
      const availability = await fetchReservationAvailability(deps.repo, settings.reservationSlotCapacity);
      // Order awareness, same best-effort discipline: who is asking
      // (their session token rides along on every chat call), their own
      // recent orders when signed in, and the one order behind a pasted
      // id when it is theirs to see. None of it can fail the chat, and
      // none of it carries identity fields into the prompt —
      // summarizeOrderForChat drops those at the boundary.
      const chatUser = await resolveChatUser(req, { repo: deps.repo, verifyToken: deps.verifyToken });
      const [recentOrdersOutcome, focusOrder] = await Promise.all([
        fetchRecentOrders(deps.repo, chatUser),
        fetchFocusOrder(deps.repo, chatUser, cleanMessages),
      ]);
      const raw = await deps.chat.reply({
        system: buildChatSystemPrompt(settings, items, {
          cart: cartSnapshot,
          availability,
          recentOrders: recentOrdersOutcome.kind === 'orders' ? recentOrdersOutcome.orders : null,
          // Only the successful-empty outcome may claim the no-orders
          // fact; 'unavailable' (guest or failed fetch) must not.
          signedInNoOrders: recentOrdersOutcome.kind === 'none',
          focusOrder,
          // The booking-fee fact reads the LIVE effective fee — the
          // prompt promises "free" only when no charge can happen.
          reservationFee: effectiveReservationFee(settings, deps.stripeConfigured ?? false),
        }),
        messages: cleanMessages,
      });
      // The BOOK marker is extracted from the model's reply BEFORE
      // the cart actions resolve, so no booking marker — whole or
      // fragmentary — can ever ride through into the visible text.
      const bookingExtract = extractBookingMarker(raw);
      const { text, actions } = resolveCartActions(bookingExtract.text, items);
      let bookingNote: string | null = null;
      let booking: ChatBookingOutcome['booking'] = null;
      if (bookingExtract.booking) {
        const outcome = await executeChatBooking(
          // Same M2 coherence as the form route: a raw service whose
          // provider cannot settle (key-only) mints no fee intent —
          // the booking follows the corrected configured flag.
          { repo: deps.repo, stripe: (deps.stripeConfigured ?? false) ? (deps.stripe ?? null) : null },
          chatUser?.id ?? null,
          bookingExtract.booking,
        );
        bookingNote = outcome.note;
        booking = outcome.booking;
      } else if (bookingExtract.markerSeen) {
        // The model attempted a booking whose details never arrived
        // whole: nothing was created, and the guest hears that from
        // the server — never the model's own implication that a
        // table exists.
        bookingNote = bookingDetailsNeededNote([]);
      }
      let reply = text || (actions.length
        ? `Added to your cart: ${actions.map((a) => `${a.quantity} × ${a.name}`).join(', ')}. Open the cart to review and check out whenever you are ready.`
        : 'That one slipped past me — say it another way and I will pick it right up.');
      if (bookingNote) {
        // The server's note is the factual tail of the reply; when
        // the model wrote nothing of its own, the note stands alone.
        reply = text || actions.length ? `${reply}\n\n${bookingNote}` : bookingNote;
      }
      res.json({ reply, actions, booking });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
