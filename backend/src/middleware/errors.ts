import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    // body-parser rejected the payload as JSON: that is the client's
    // mistake (400), not a server fault (500).
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    res.status(400).json({ error: issues[0]?.message ?? 'Validation failed', issues });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
