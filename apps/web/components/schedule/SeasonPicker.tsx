'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { cn } from '@apex/ui';
import { Icon } from '@/components/ds';

/** The page a season choice opens: the template with "{season}" replaced. */
export function seasonHref(template: string, season: number | string): string {
  return template.replace('{season}', String(season));
}

/**
 * Jump to any season (1950 to the newest published). A native <select>
 * keeps keyboard and screen-reader behaviour. Choosing a year does not
 * navigate on its own (arrowing through a closed select fires a change on
 * every step on Windows, WCAG 3.2.2): the reader confirms with "Open".
 * The season tabs beside it are plain links and work without JavaScript.
 */
export function SeasonPicker({ seasons, current, hrefFor, label = 'Any season', className }: { seasons: number[]; current: number; hrefFor: string; label?: string; className?: string }) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    // The route moved to another season (tabs, back button): follow it.
    setShown(current);
    setValue(String(current));
  }
  const [pending, start] = useTransition();
  const changed = value !== String(current);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!changed) return;
    start(() => router.push(seasonHref(hrefFor, value)));
  };
  return (
    <form onSubmit={submit} aria-label="Open another season" className={cn('flex min-w-0 flex-wrap items-center gap-3', className)}>
      <label htmlFor={id} className="shrink-0 font-text text-label uppercase text-fg-3">{label}</label>
      <span className="flex items-stretch">
        <span className="relative inline-flex">
          <select
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-11 appearance-none bg-tone-raised py-2 pl-3 pr-10 font-text text-ui font-[650] text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)] focus-visible:outline-2"
          >
            {seasons.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-2" />
        </span>
        <button
          type="submit"
          aria-busy={pending || undefined}
          disabled={!changed || pending}
          className={cn(
            'min-h-11 px-4 font-text text-ui font-[650] transition-colors duration-[var(--duration-fast)]',
            changed ? 'bg-fg text-tone hover:bg-fg-2' : 'text-fg-3 shadow-[inset_0_0_0_1px_var(--rule-strong)]',
          )}
        >
          {pending ? 'Opening' : 'Open'}
        </button>
      </span>
    </form>
  );
}
