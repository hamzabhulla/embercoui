import { describe, expect, it } from 'vitest';
import { sanitizeReturnPath } from './auth';

// Audit-2 fix 10 — the post-auth return-path sanitiser, the single
// definition shared by the router and Google OAuth. Only plain
// same-origin app paths survive; everything else lands on '/'.

describe('sanitizeReturnPath', () => {
  it('falls back to home for empty input', () => {
    expect(sanitizeReturnPath(null)).toBe('/');
    expect(sanitizeReturnPath(undefined)).toBe('/');
    expect(sanitizeReturnPath('')).toBe('/');
  });

  it('keeps plain app paths, including query strings', () => {
    expect(sanitizeReturnPath('/')).toBe('/');
    expect(sanitizeReturnPath('/menu')).toBe('/menu');
    expect(sanitizeReturnPath('/account?tab=orders')).toBe('/account?tab=orders');
    expect(sanitizeReturnPath('/track-order/9b1c2d')).toBe('/track-order/9b1c2d');
  });

  it('rejects anything that could leave the origin', () => {
    expect(sanitizeReturnPath('//evil.com')).toBe('/'); // protocol-relative
    expect(sanitizeReturnPath('///evil.com')).toBe('/');
    expect(sanitizeReturnPath('/\\evil.com')).toBe('/'); // backslash host trick
    expect(sanitizeReturnPath('/foo\\bar')).toBe('/'); // a backslash ANYWHERE disqualifies
    expect(sanitizeReturnPath('https://evil.com')).toBe('/');
    expect(sanitizeReturnPath('menu')).toBe('/'); // no leading slash
    expect(sanitizeReturnPath('javascript:alert(1)')).toBe('/');
  });

  it('never returns to an auth route (exact matches only)', () => {
    expect(sanitizeReturnPath('/login')).toBe('/');
    expect(sanitizeReturnPath('/signup')).toBe('/');
    expect(sanitizeReturnPath('/forgot-password')).toBe('/');
    expect(sanitizeReturnPath('/reset-password')).toBe('/');
    // A mere prefix is NOT blocked — the list is exact-match.
    expect(sanitizeReturnPath('/login-help')).toBe('/login-help');
  });

  // Current behaviour, pinned deliberately (audit-2 Low, same-origin
  // so not a security hole): the blocklist is an exact string match,
  // so a trailing slash or different casing slips past it. If the
  // sanitiser is ever hardened to normalise first, these two
  // expectations are the ones to flip.
  it('pins the exact-match seam: /login/ and /LOGIN currently pass through', () => {
    expect(sanitizeReturnPath('/login/')).toBe('/login/');
    expect(sanitizeReturnPath('/LOGIN')).toBe('/LOGIN');
  });
});
