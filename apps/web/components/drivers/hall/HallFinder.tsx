'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/ds';
import '@/components/brand-c/brand-c.css';

/**
 * "Find a champion": choosing a name lights that champion's plaques across
 * every decade and steps the others back to a quieter tone (never hidden,
 * so the order of the sheet is kept, and never below AA contrast). Works on the server-rendered hall by
 * setting a data attribute on it; without JavaScript every plaque is simply
 * shown at full strength.
 */
export function HallFinder({ hallId, options, label }: { hallId: string; options: Array<{ key: string; label: string }>; label: string }) {
  const id = useId();
  const [focus, setFocus] = useState('');
  const safe = focus.replace(/[^a-z0-9_-]/gi, '');
  const chosen = options.find((o) => o.key === focus);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="bc-label text-[color:var(--bc-silver,var(--fg-2))]">{label}</label>
      <div className="relative">
        <select
          id={id}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          className="min-h-14 w-full min-w-[min(18rem,100%)] appearance-none rounded-full bg-white/[0.04] pl-6 pr-12 text-[1rem] text-[color:var(--bc-white,var(--fg))] ring-1 ring-white/45 focus:outline-none focus:ring-2 focus:ring-white [&>option]:bg-[#111114]"
        >
          <option value="">Show every champion</option>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[color:var(--bc-silver,var(--fg-2))]" />
      </div>
      <p aria-live="polite" className="min-h-[1.45em] text-[0.875rem] text-[color:var(--bc-silver,var(--fg-2))]">{chosen ? `Highlighting ${chosen.label}` : ''}</p>
      {safe && (
        // Others step back without losing contrast: their pictures dim and grey (imagery
        // carries no text), their text drops to the tone's tertiary ink, which still meets
        // AA. The chosen plaques take the red top rule (red = selected).
        <style>{`#${hallId} [data-key]:not([data-key="${safe}"]) :is(img,[data-media-state]){opacity:.3;filter:grayscale(1);transition:opacity var(--duration-base) var(--ease-out)}#${hallId} [data-key]:not([data-key="${safe}"]) *{color:var(--bc-titanium,var(--fg-3))}#${hallId} [data-key="${safe}"] .dr-frame{outline:2px solid var(--bc-red,#e10600);outline-offset:6px}#${hallId} [data-key="${safe}"]{box-shadow:inset 0 3px 0 var(--color-brand-red)}`}</style>
      )}
    </div>
  );
}
