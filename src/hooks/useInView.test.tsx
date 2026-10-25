/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { useInView } from './useInView';

// Scroll-reveal latch: a reveal animation must play exactly once per
// page load. The old hook mirrored entry.isIntersecting into state,
// so scrolling a section out of view reset it and scrolling back
// replayed the animation. The latch keeps an element visible once
// seen and disconnects its observer on first intersect.

type Entry = { isIntersecting: boolean; target: Element };
type Callback = (entries: Entry[]) => void;

class ObserverStub {
  static instances: ObserverStub[] = [];
  callback: Callback;
  observed: Element[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(cb: Callback) {
    this.callback = cb;
    ObserverStub.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting, target: this.observed[0] }]);
  }
}

function Probe() {
  const { ref, isInView } = useInView<HTMLDivElement>(0.1);
  return createElement('div', {
    ref,
    'data-testid': 'probe',
    'data-inview': String(isInView),
  });
}

async function waitForObserver() {
  // The hook creates its observer inside a double requestAnimationFrame;
  // jsdom fires rAF on ~16ms timers, so a short real wait covers both.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  ObserverStub.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = ObserverStub;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('useInView latch', () => {
  it('intersect -> visible, exit -> STILL visible, re-enter -> still visible, observer disconnected', async () => {
    const { container } = render(createElement(Probe));
    await waitForObserver();
    expect(ObserverStub.instances).toHaveLength(1);
    const observer = ObserverStub.instances[0];
    const el = () => container.firstChild as HTMLElement;

    expect(el().getAttribute('data-inview')).toBe('false');

    act(() => observer.trigger(true));
    expect(el().getAttribute('data-inview')).toBe('true');
    expect(observer.disconnect).toHaveBeenCalledTimes(1);

    // Scrolling out of view must NOT reset it (the old toggle bug).
    act(() => observer.trigger(false));
    expect(el().getAttribute('data-inview')).toBe('true');

    // Scrolling back in must NOT replay anything: still visible, and
    // no second disconnect (the observer already stopped watching).
    act(() => observer.trigger(true));
    expect(el().getAttribute('data-inview')).toBe('true');
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stays hidden while never intersecting and does not disconnect early', async () => {
    const { container } = render(createElement(Probe));
    await waitForObserver();
    const observer = ObserverStub.instances[0];

    act(() => observer.trigger(false));
    expect((container.firstChild as HTMLElement).getAttribute('data-inview')).toBe('false');
    expect(observer.disconnect).not.toHaveBeenCalled();
  });

  it('still disconnects on unmount before any intersect (cleanup preserved)', async () => {
    const { unmount } = render(createElement(Probe));
    await waitForObserver();
    const observer = ObserverStub.instances[0];
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });
});
