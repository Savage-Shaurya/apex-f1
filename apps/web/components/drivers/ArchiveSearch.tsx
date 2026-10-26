import { Icon } from '@/components/ds';

/**
 * Plain GET form into a directory (/drivers/all?q=…): works without
 * JavaScript. Carbon & Light: a lit pill field with the search as the solid
 * white button beside it (stacked on narrow phones).
 */
export function ArchiveSearch({ action, label, placeholder }: { action: string; label: string; placeholder: string }) {
  const id = `archive-${action.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <form action={action} method="get" role="search" className="flex flex-col gap-3">
      <label htmlFor={id} className="bc-label text-[color:var(--bc-silver)]">{label}</label>
      <div className="flex flex-col gap-3 min-[420px]:flex-row">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={20} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[color:var(--bc-titanium)]" />
          <input
            id={id}
            name="q"
            type="search"
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="min-h-14 w-full rounded-full bg-white/[0.04] pl-12 pr-5 text-[1.05rem] text-[color:var(--bc-white)] ring-1 ring-white/45 transition-shadow placeholder:text-[color:var(--bc-titanium)] focus:outline-none focus:ring-2 focus:ring-[color:var(--bc-white)]"
          />
        </div>
        <button type="submit" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--bc-white)] px-7 text-[0.95rem] font-semibold text-[color:var(--bc-night)] transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 hover:bg-white active:scale-[0.97] motion-reduce:transform-none">
          Search <span aria-hidden>→</span>
        </button>
      </div>
    </form>
  );
}
