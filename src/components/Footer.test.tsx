/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from './Footer';

// Footer columns use their own direct IntersectionObserver (not the
// useInView hook), with the same latch contract: a column reveals
// exactly once per page load — scrolling away and back must not
// hide it again or replay the animation.

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

vi.mock('../hooks/usePublicSettings', () => ({
  usePublicSettings: () => null,
}));

beforeEach(() => {
  ObserverStub.instances = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = ObserverStub;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('Footer reveal latch', () => {
  it('column reveals once and stays visible across exit and re-enter', () => {
    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    // One observer per column (brand / links / contact).
    expect(ObserverStub.instances).toHaveLength(3);
    const columns = container.querySelectorAll('.reveal');
    expect(columns.length).toBe(3);

    const first = columns[0];
    expect(first.classList.contains('visible')).toBe(false);

    act(() => ObserverStub.instances[0].trigger(true));
    expect(first.classList.contains('visible')).toBe(true);
    expect(ObserverStub.instances[0].disconnect).toHaveBeenCalledTimes(1);

    // Scroll out: must NOT hide again (the old toggle bug).
    act(() => ObserverStub.instances[0].trigger(false));
    expect(first.classList.contains('visible')).toBe(true);

    // Scroll back in: must NOT replay — still visible, no second disconnect.
    act(() => ObserverStub.instances[0].trigger(true));
    expect(first.classList.contains('visible')).toBe(true);
    expect(ObserverStub.instances[0].disconnect).toHaveBeenCalledTimes(1);

    // The other columns are untouched by the first column's observer.
    expect(columns[1].classList.contains('visible')).toBe(false);
    expect(columns[2].classList.contains('visible')).toBe(false);
  });
});
