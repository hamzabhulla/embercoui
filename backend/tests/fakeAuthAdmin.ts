import type { AuthAdminService, MfaFactorInfo } from '../src/lib/authAdmin';

/**
 * In-memory AuthAdminService for route tests: factors are seeded per
 * user, every call is recorded, and list/delete behave like the real
 * Admin API (a delete removes exactly that user's factor). Set
 * `failWith` to make the next calls throw, pinning the endpoint's
 * honest 502 instead of a half-completed reset.
 */
export class FakeAuthAdminService implements AuthAdminService {
  factors = new Map<string, MfaFactorInfo[]>();
  calls: { method: 'list' | 'delete'; userId: string; factorId?: string }[] = [];
  failWith: Error | null = null;

  seed(userId: string, factors: MfaFactorInfo[]) {
    this.factors.set(userId, [...factors]);
  }

  async listMfaFactors(userId: string) {
    this.calls.push({ method: 'list', userId });
    if (this.failWith) throw this.failWith;
    return [...(this.factors.get(userId) ?? [])];
  }

  async deleteMfaFactor(userId: string, factorId: string) {
    this.calls.push({ method: 'delete', userId, factorId });
    if (this.failWith) throw this.failWith;
    this.factors.set(userId, (this.factors.get(userId) ?? []).filter((f) => f.id !== factorId));
  }
}
