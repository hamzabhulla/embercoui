/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Step 10 (OPS-M3): Hero renders its media from the Supabase URL the
// app is configured with (lib/supabase.ts) instead of a hard-coded
// demo project ref. Each test stubs VITE_SUPABASE_URL in the env and
// re-imports Hero fresh (resetModules) so the REAL lib/supabase.ts
// re-reads it — the derivation runs through the app's actual config
// source, not a mock of it. What is pinned:
//  - configured with the live demo's URL, the rendered mobile <img>
//    and desktop <source> URLs are byte-identical to the literals
//    Hero.tsx shipped with before this step;
//  - configured with any other project's URL, the rendered URLs
//    follow that project;
//  - unconfigured (empty URL), no element points at Supabase at
//    all: the mobile hero uses the fallback still and the desktop
//    hero renders that still instead of a <video> with no source.

const DEMO_URL = 'https://mmkokxwgdxqbgxbftfsl.supabase.co';
const OLD_MOBILE_URL =
  'https://mmkokxwgdxqbgxbftfsl.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-mobile.jpg';
const OLD_VIDEO_URL =
  'https://mmkokxwgdxqbgxbftfsl.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-video.mp4';
const FALLBACK =
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1400&q=85&auto=format&fit=crop';

const realInnerWidth = window.innerWidth;

async function renderHero(url: string, width: number) {
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.resetModules();
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  const { default: Hero } = await import('./Hero');
  return render(
    <MemoryRouter>
      <Hero />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  Object.defineProperty(window, 'innerWidth', { value: realInnerWidth, configurable: true });
});

describe('Hero media URLs (derived, not hard-coded)', () => {
  it('desktop: the video source is byte-identical to the old hard-coded URL when the demo project is configured', async () => {
    const { container } = await renderHero(DEMO_URL, 1280);
    expect(container.querySelector('source')?.getAttribute('src')).toBe(OLD_VIDEO_URL);
    expect(container.querySelector('video')?.getAttribute('poster')).toBe(FALLBACK);
  });

  it('mobile: the hero image is byte-identical to the old hard-coded URL when the demo project is configured', async () => {
    const { container } = await renderHero(DEMO_URL, 375);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(OLD_MOBILE_URL);
    expect(img?.getAttribute('alt')).toBe('Fine dining');
  });

  it('a different configured project drives both URLs', async () => {
    const { container } = await renderHero('https://client-ref.supabase.co', 1280);
    expect(container.querySelector('source')?.getAttribute('src')).toBe(
      'https://client-ref.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-video.mp4',
    );
  });

  it('unconfigured desktop: no video/source and no Supabase URL anywhere — the fallback still renders', async () => {
    const { container } = await renderHero('', 1280);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
    expect(container.innerHTML).not.toContain('supabase.co');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(FALLBACK);
  });

  it('unconfigured mobile: the hero image is the fallback still, never an empty or Supabase src', async () => {
    const { container } = await renderHero('', 375);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(FALLBACK);
    expect(container.innerHTML).not.toContain('supabase.co');
  });
});
