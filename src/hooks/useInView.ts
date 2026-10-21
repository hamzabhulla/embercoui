import { useEffect, useRef, useState } from 'react';

export function useInView<T extends HTMLElement = HTMLElement>(threshold = 0.1) {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let observer: IntersectionObserver;
    let raf2: number;

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        observer = new IntersectionObserver(
          ([entry]) => {
            setIsInView(entry.isIntersecting);
          },
          { threshold }
        );
        observer.observe(el);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (observer) observer.disconnect();
    };
  }, [threshold]);

  return { ref, isInView };
}
