'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@apex/ui';

const TAB = 'relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-1 font-text text-ui font-[650] text-fg-2 transition-colors hover:text-fg aria-selected:text-fg aria-[current=page]:text-fg';
const BAR = 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:bg-brand-red after:transition-transform after:duration-[var(--duration-slow)] after:ease-[var(--ease-out)] aria-selected:after:scale-x-100 aria-[current=page]:after:scale-x-100 hover:after:scale-x-100';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * In-page tabs (WAI-ARIA tabs pattern): arrow keys move between tabs,
 * Home/End jump, the active panel is the only one in the tab order.
 */
export function Tabs({ items, label, defaultTab, className, onChange }: { items: TabItem[]; label: string; defaultTab?: string; className?: string; onChange?: (id: string) => void }) {
  const base = useId();
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    setActive(item.id);
    onChange?.(item.id);
    refs.current[(index + items.length) % items.length]?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 };
    if (event.key in keys) {
      event.preventDefault();
      select(keys[event.key]!);
    }
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto border-b border-rule no-scrollbar">
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(node) => { refs.current[i] = node; }}
            id={`${base}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={active === item.id}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={active === item.id ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(TAB, BAR)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${base}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={active !== item.id}
          tabIndex={0}
          className="pt-6 focus-visible:outline-offset-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

/** Route tabs (season, drivers/teams): real links, current page marked. */
export function TabLinks({ items, label, className }: { items: { href: string; label: ReactNode; current?: boolean }[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('border-b border-rule', className)}>
      <ul className="flex gap-6 overflow-x-auto no-scrollbar">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link href={item.href} aria-current={item.current ? 'page' : undefined} className={cn(TAB, BAR)}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
