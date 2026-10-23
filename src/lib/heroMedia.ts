/**
 * Public URLs for the homepage hero media.
 *
 * The files live in the public `hero-portfolio-video` storage bucket
 * (created by migration 0009) of the install's OWN Supabase project, so
 * their URLs are derived from the configured Supabase URL — the same
 * `VITE_SUPABASE_URL` the rest of the app uses (see lib/supabase.ts) —
 * never from a hard-coded project ref. A client install therefore
 * needs no code edit: set the env var, upload the two files, done.
 *
 * The public-object URL pattern is Supabase's own:
 *   <SUPABASE_URL>/storage/v1/object/public/<bucket>/<file>
 * With the live demo's URL configured this produces byte-identical
 * URLs to the ones the hero previously hard-coded.
 *
 * When no Supabase URL is configured the helpers return null and the
 * hero falls back to HERO_FALLBACK_IMAGE — the same still image it
 * already used as the desktop video's poster/fallback — so an
 * unconfigured install shows a working image instead of a broken
 * <img>/<source> pointing nowhere.
 */
export const HERO_BUCKET = 'hero-portfolio-video';

export const HERO_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1400&q=85&auto=format&fit=crop';

export function heroMediaUrl(
  supabaseUrl: string | null | undefined,
  file: string,
): string | null {
  const base = supabaseUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${HERO_BUCKET}/${file}`;
}

export function heroMobileImageUrl(supabaseUrl: string | null | undefined): string | null {
  return heroMediaUrl(supabaseUrl, 'hero-mobile.jpg');
}

export function heroVideoUrl(supabaseUrl: string | null | undefined): string | null {
  return heroMediaUrl(supabaseUrl, 'hero-video.mp4');
}
