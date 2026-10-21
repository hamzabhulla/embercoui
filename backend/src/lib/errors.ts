export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notConfigured = () => new ApiError(503, 'Supabase not configured');
export const stripeNotConfigured = () => new ApiError(503, 'Payments are not configured');
