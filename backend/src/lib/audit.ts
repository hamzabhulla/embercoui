import type { Request } from 'express';
import type { AuditEventInput, Repository } from '../repositories/types';

/**
 * Audit foundation (Phase A; Phase C adds the mutation hooks and the
 * Security & Activity read API + UI on top of it).
 *
 * `audit(deps, req, event)` appends one row to audit_events describing a
 * privileged mutation: who did it (from the VERIFIED profile — id,
 * display label, role), what changed (per-field { from, to }), from
 * where (ip — req.ip already honors the app's TRUST_PROXY setting — and
 * user-agent). The owner's own actions are logged exactly like everyone
 * else's; there is no exemption.
 *
 * Best-effort by design: auditing must never break the operation it
 * records. A failed write (including the pre-0012 database, where the
 * repository degrades the insert to a no-op) is swallowed here after a
 * console.error, and the mutation proceeds.
 */
export interface AuditEvent {
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * The action taxonomy (Phase C). Every action belongs to one of two
 * categories, derived from its name alone — the audit_events table
 * carries no category column, and none is needed:
 *
 *   - 'auth'   — session events, all prefixed `auth.` (auth.login,
 *                auth.mfa_verified, auth.logout, auth.login_failed);
 *   - 'change' — everything else: a privileged mutation of data
 *                (order.status_changed, menu_item.updated, …).
 *
 * Trust is derived the same way. Every row is written by trusted
 * server code from a VERIFIED token — except `auth.login_failed`:
 * a failed password dies inside Supabase Auth and never reaches this
 * backend, so the sign-in page reports it after the fact and that
 * report is unverified by construction. The action name is the one
 * and only writer of that kind of row, so it is a sound marker: the
 * read API exposes it as metadata.verified=false / source
 * 'client-report', and the Security UI badges it "Unverified report".
 */
export type AuditCategory = 'auth' | 'change';

export function auditCategoryOf(action: string): AuditCategory {
  return action.startsWith('auth.') ? 'auth' : 'change';
}

export function auditVerifiedOf(action: string): boolean {
  return action !== 'auth.login_failed';
}

interface AuthedLike {
  user?: { id: string; email: string; role: string; profile: { fullName: string | null } | null } | null;
}

export async function audit(deps: { repo: Repository | null }, req: Request, event: AuditEvent): Promise<void> {
  const user = (req as AuthedLike).user;
  if (!deps.repo || !user) return;
  const input: AuditEventInput = {
    actorId: user.id,
    actorLabel: user.profile?.fullName ?? user.email ?? null,
    actorRole: user.role,
    action: event.action,
    entity: event.entity ?? null,
    entityId: event.entityId ?? null,
    summary: event.summary ?? null,
    changes: event.changes ?? null,
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
  try {
    await deps.repo.insertAuditEvent(input);
  } catch (err) {
    console.error('[ember] audit write failed:', err instanceof Error ? err.message : err);
  }
}
