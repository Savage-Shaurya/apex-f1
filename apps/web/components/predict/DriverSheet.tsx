'use client';

import { handleFilterKey } from './filter-key';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from '@apex/ui';
import { Button, Icon, Input, normalizeHex } from '@/components/ds';

export interface PickDriver {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  team: string | null;
  color: string | null;
  number: number | null;
  code: string | null;
  headshot: string | null;
  portrait: string | null;
}

/**
 * The driver picker: a native modal dialog (focus contained, Escape closes,
 * focus returns to the slot that opened it) holding the real grid as a radio
 * group, grouped by team. Arrow keys move between drivers, type to filter,
 * Enter or Space picks. Phones get it full screen.
 */
export function DriverSheet({
  open,
  title,
  drivers,
  selected,
  taken,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  drivers: PickDriver[];
  selected: string | null;
  /** Drivers already used for another call, shown as a note (picks may repeat). */
  taken: Map<string, string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<string | null>(selected);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQuery('');
      const start = selected ?? drivers[0]?.id ?? null;
      setFocus(start);
      // Start on the current pick (or the first driver), not on the close button.
      if (start) window.requestAnimationFrame(() => tiles.current.get(start)?.focus());
    }
    if (!open && d.open) d.close();
  }, [open, selected, drivers]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? drivers.filter((d) => `${d.name} ${d.team ?? ''} ${d.code ?? ''} ${d.number ?? ''}`.toLowerCase().includes(q)) : drivers;
    const byTeam = new Map<string, PickDriver[]>();
    for (const d of list) {
      const key = d.team ?? 'Team not published';
      byTeam.set(key, [...(byTeam.get(key) ?? []), d]);
    }
    return [...byTeam];
  }, [drivers, query]);
  const flat = groups.flatMap(([, list]) => list);
  const active = flat.find((d) => d.id === focus)?.id ?? flat[0]?.id ?? null;

  const move = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = flat.findIndex((d) => d.id === id);
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    // Type to filter from anywhere in the grid.
    if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setQuery((q) => q + event.key);
      document.getElementById(`${titleId}-q`)?.focus();
      return;
    }
    let next: number | null = null;
    if (event.key in step) next = (i + step[event.key]! + flat.length) % flat.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = flat.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = flat[next]!;
    setFocus(target.id);
    tiles.current.get(target.id)?.focus();
  };

  // The filter sits inside the picks form: Enter picks the highlighted driver and never submits it (R3-CLICK-2).
  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => handleFilterKey(event, {
    active,
    pick: onPick,
    close: onClose,
    focusTile: (id) => { setFocus(id); tiles.current.get(id)?.focus(); },
  });

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className="tone-deep m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-tone p-0 text-fg shadow-[var(--shadow-overlay),0_0_0_1px_var(--rule-strong)] backdrop:bg-black/75 sm:m-auto sm:h-auto sm:max-h-[88dvh] sm:w-[min(64rem,calc(100vw-3rem))]"
    >
      <div className="sticky top-0 z-[1] bg-tone px-4 pb-4 pt-4 shadow-[inset_0_-1px_0_var(--rule)] sm:px-8 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-text text-heading-m text-fg">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close without picking" className="-mr-3 shrink-0 px-3">
            <Icon name="close" size={22} />
          </Button>
        </div>
        <div className="mt-3">
          <label htmlFor={`${titleId}-q`} className="sr-only">Filter drivers</label>
          <Input id={`${titleId}-q`} type="search" onKeyDown={onFilterKey} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name, number or team" autoComplete="off" aria-describedby={hintId} />
          <p id={hintId} className="mt-2 font-text text-caption text-fg-3">Arrow keys move between drivers. Enter picks the highlighted driver. Escape closes.</p>
        </div>
      </div>

      <div role="radiogroup" aria-labelledby={titleId} className="px-4 py-6 sm:px-8">
        {flat.length === 0 && <p className="py-8 font-text text-body text-fg-2">No driver matches &ldquo;{query}&rdquo;.</p>}
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
          {groups.map(([team, list]) => (
            <section key={team} aria-label={team} className="min-w-0">
              <p className="mb-3 flex min-w-0 items-center gap-2.5 font-text text-small font-[650] text-fg-2">
                <span aria-hidden className="h-[1.1em] w-1 shrink-0" style={{ backgroundColor: list[0]?.color ?? 'var(--rule-strong)' }} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{team}</span>
              </p>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {list.map((d) => {
                  const checked = d.id === selected;
                  const other = taken.get(d.id);
                  return (
                    <button
                      key={d.id}
                      ref={(node) => { if (node) tiles.current.set(d.id, node); else tiles.current.delete(d.id); }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={d.id === active ? 0 : -1}
                      onKeyDown={(e) => move(e, d.id)}
                      onFocus={() => setFocus(d.id)}
                      onClick={() => onPick(d.id)}
                      className={cn(
                        'group/tile grid min-h-[5.5rem] grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 bg-tone-raised p-2 pr-3 text-left transition-[background-color,box-shadow] duration-[var(--duration-fast)] hover:bg-tone-hover',
                        checked && 'shadow-[inset_0_0_0_2px_var(--color-brand-red)]',
                      )}
                    >
                      <TilePortrait driver={d} />
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-2 font-text text-caption text-fg-3">
                          {d.number != null && <span className="font-[650] tabular-nums text-fg-2">{d.number}</span>}
                          {d.code && <span>{d.code}</span>}
                        </span>
                        <span className="block font-text text-small text-fg-2">{d.firstName}</span>
                        <span className="block font-text text-ui font-[650] text-fg [overflow-wrap:anywhere]">{d.lastName}</span>
                        {other && <span className="mt-0.5 block font-text text-caption text-fg-3">Also your {other.toLowerCase()} pick</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}

/**
 * Small square portrait for a tile (phrasing content, so it can sit inside a
 * button): the F1 CDN cut-out contained on the team field, a credited
 * Wikimedia portrait contained if that is all there is, or the driver code.
 */
function TilePortrait({ driver }: { driver: PickDriver }) {
  const [failed, setFailed] = useState(false);
  // Wikimedia portraits need a credit beside them, so tiles use only the F1 CDN cut-out (credited in the footer).
  const src = driver.headshot;
  return (
    // Same portrait field as every other driver picture (components/ds/portrait.css).
    <span aria-hidden className="ds-portrait block aspect-square" data-framing="head" style={{ '--portrait-team': normalizeHex(driver.color) ?? undefined } as CSSProperties}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny CDN cut-out; SmartImage renders block-level markup that cannot sit in a button
        <img src={src} alt="" loading="lazy" decoding="async" width={72} height={72} onError={() => setFailed(true)} className="absolute inset-0 z-[1] size-full object-contain object-top" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center font-text text-ui font-[750] tracking-[0.04em]" style={{ color: 'var(--portrait-ink)' }}>{driver.code ?? driver.lastName.slice(0, 3).toUpperCase()}</span>
      )}
    </span>
  );
}
