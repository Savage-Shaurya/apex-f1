'use client';

import { useEffect, useState } from 'react';

export interface IndexItem {
  id: string;
  label: string;
}

/**
 * Sticky in-page index for editorial and legal pages. Highlights the
 * section currently in view (IntersectionObserver, no scroll loop).
 */
export function SideIndex({ items, label = 'On this page' }: { items: IndexItem[]; label?: string }) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label={label} className="sticky top-[calc(var(--nav-offset)+1.5rem)] transition-[top] duration-500">
      <p className="font-data text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">{label}</p>
      <ol className="mt-4 border-l border-white/[0.1]">
        {items.map((item, i) => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? 'location' : undefined}
                className={`relative -ml-px flex min-h-10 items-center gap-3 border-l-2 pl-4 font-data text-[11px] uppercase tracking-[0.16em] transition-colors ${on ? 'border-telemetry-red text-on-background' : 'border-transparent text-on-surface-variant hover:text-on-background'}`}
              >
                <span className={on ? 'text-telemetry-red' : 'text-white/30'}>{String(i + 1).padStart(2, '0')}</span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
