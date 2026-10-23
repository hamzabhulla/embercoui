import { describe, expect, it } from 'vitest';
import { HERO_FALLBACK_IMAGE, heroMediaUrl, heroMobileImageUrl, heroVideoUrl } from './heroMedia.ts';

// Step 10 (OPS-M3): the hero media URLs are derived from the
// configured Supabase URL, not hard-coded to the demo project. The
// literals below are the EXACT URLs Hero.tsx shipped with before
// this step — with the live demo's project URL configured, the
// derivation must reproduce them byte for byte.
const DEMO_URL = 'https://mmkokxwgdxqbgxbftfsl.supabase.co';
const OLD_MOBILE_URL =
  'https://mmkokxwgdxqbgxbftfsl.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-mobile.jpg';
const OLD_VIDEO_URL =
  'https://mmkokxwgdxqbgxbftfsl.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-video.mp4';

describe('heroMediaUrl (derived from the configured Supabase URL)', () => {
  it('reproduces the previously hard-coded demo URLs byte-identically', () => {
    expect(heroMobileImageUrl(DEMO_URL)).toBe(OLD_MOBILE_URL);
    expect(heroVideoUrl(DEMO_URL)).toBe(OLD_VIDEO_URL);
    expect(heroMediaUrl(DEMO_URL, 'hero-mobile.jpg')).toBe(OLD_MOBILE_URL);
    expect(heroMediaUrl(DEMO_URL, 'hero-video.mp4')).toBe(OLD_VIDEO_URL);
  });

  it('points at whatever project is configured, not the demo project', () => {
    expect(heroVideoUrl('https://client-ref.supabase.co')).toBe(
      'https://client-ref.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-video.mp4',
    );
    expect(heroMobileImageUrl('https://client-ref.supabase.co')).toBe(
      'https://client-ref.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-mobile.jpg',
    );
  });

  it('a trailing slash on the configured URL does not double the slash', () => {
    expect(heroVideoUrl(`${DEMO_URL}/`)).toBe(OLD_VIDEO_URL);
    expect(heroMobileImageUrl(`${DEMO_URL}///`)).toBe(OLD_MOBILE_URL);
  });

  it('unset or blank config yields null (the hero then uses its fallback still)', () => {
    expect(heroVideoUrl(undefined)).toBeNull();
    expect(heroVideoUrl(null)).toBeNull();
    expect(heroVideoUrl('')).toBeNull();
    expect(heroMobileImageUrl('   ')).toBeNull();
    expect(heroMediaUrl(undefined, 'hero-video.mp4')).toBeNull();
  });

  it('the fallback is the still the hero already used as poster/fallback', () => {
    expect(HERO_FALLBACK_IMAGE).toBe(
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1400&q=85&auto=format&fit=crop',
    );
  });
});
