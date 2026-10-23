export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Optional machine-readable code, included in the error response
     * body as `code` next to the human-readable `error`. Only errors
     * the client must ACT on programmatically carry one (e.g. the
     * MFA gate's MFA_REQUIRED, which routes the admin shell to its
     * verification screen) — the rest stay message-only, as before.
     */
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notConfigured = () => new ApiError(503, 'Supabase not configured');
export const stripeNotConfigured = () => new ApiError(503, 'Payments are not configured');
