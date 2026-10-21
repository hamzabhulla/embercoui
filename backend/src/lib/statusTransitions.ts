import type { OrderStatus, ReservationDTO } from '../repositories/types';

export type ReservationStatus = ReservationDTO['status'];

/**
 * Fulfilment state machines (production audit Fix 8 / M4).
 *
 * Until now the admin status endpoints accepted ANY status jump — a
 * delivered order could be dragged back to pending, a completed
 * reservation reopened — because only the enum was validated. These
 * tables are the single source of truth for legal moves; the admin
 * routes enforce them against the CURRENT stored state before writing.
 * Same-status writes are always allowed (a no-op: admin UIs re-send
 * state, and a retry must not fail).
 *
 * Orders mirror the customer tracking lifecycle (pending → confirmed →
 * preparing → ready → out_for_delivery → delivered) and may be
 * cancelled at any point BEFORE the courier leaves; once an order is
 * out for delivery it can only complete. Delivered and cancelled are
 * terminal.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Reservations: a pending booking is confirmed or cancelled; a
 * confirmed booking is completed (the party came) or cancelled.
 * Completed and cancelled are terminal.
 */
export const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function isLegalOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

export function isLegalReservationTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return from === to || RESERVATION_TRANSITIONS[from].includes(to);
}
