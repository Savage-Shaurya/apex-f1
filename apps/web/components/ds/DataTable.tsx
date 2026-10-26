import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { normalizeHex } from './color';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** Numbers align right; names align left. */
  align?: 'start' | 'end' | 'center';
  /** Tabular figures + right alignment. */
  numeric?: boolean;
  /** Hide on narrow screens (the row keeps its essential columns). */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Fixed column width (CSS), e.g. "4rem". */
  width?: string;
  /** Row header cell (the driver/team name), for screen readers. */
  rowHeader?: boolean;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

/**
 * The timing sheet. Real <table> semantics, ruled rows (tables are the one
 * place rules belong), tabular figures, sticky header, horizontal scroll
 * region that is keyboard-focusable so narrow screens can scroll it.
 * Works on carbon or paper through tone tokens.
 *
 * Colour roles never share a mark: the start stripe is always the team
 * colour (data); a highlighted row (leader, selected driver) is a tone step
 * plus a red rule along the row's top edge, never a red stripe, so Ferrari
 * red and "selected" cannot be confused.
 *
 * Width: a timing sheet keeps name and numbers close. `width="sheet"`
 * (default) caps the table at 60rem; put a StatGroup or rail beside it on
 * wide screens. `width="full"` is for dense live towers with many columns.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = false,
  highlight,
  accent,
  density = 'comfortable',
  empty,
  width = 'sheet',
  highlightLabel,
  fit = false,
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** Required: names the table for assistive tech. */
  caption: ReactNode;
  captionHidden?: boolean;
  /** Mark rows (leader, selected driver): tone step + red top rule. */
  highlight?: (row: Row) => boolean;
  /** Screen-reader note appended to highlighted rows' first cell, e.g. "leader". */
  highlightLabel?: string;
  /** Team colour stripe at the row's start. */
  accent?: (row: Row) => string | null | undefined;
  density?: 'comfortable' | 'compact';
  empty?: ReactNode;
  width?: 'sheet' | 'full';
  /**
   * Fit the viewport instead of scrolling sideways on phones. Use when the
   * columns left after `hideBelow` (pos, name, the key number) fit 288px.
   */
  fit?: boolean;
  className?: string;
}) {
  const pad = density === 'compact' ? 'py-2' : 'py-3.5';
  return (
    <div
      role="region"
      aria-label={typeof caption === 'string' ? caption : undefined}
      tabIndex={0}
      data-scroll-hint={fit ? undefined : ''}
      className={cn('relative min-w-0 overflow-x-auto focus-visible:outline-offset-[-2px]', width === 'sheet' && 'max-w-[60rem]', className)}
    >
      {!fit && (
        // Phones scroll a wide sheet sideways: say so instead of hiding the last columns at the frame edge.
        <p aria-hidden className="sticky left-0 mb-2 flex items-center gap-2 font-text text-caption text-fg-3 sm:hidden">
          <span className="inline-block h-px w-5 bg-current" />
          Swipe the table sideways for more columns
        </p>
      )}
      <table className={cn('w-full border-collapse text-left font-text text-ui tabular-nums', !fit && 'min-w-[34rem] sm:min-w-0')}>
        <caption className={cn('mb-3 text-left font-text text-small text-fg-2', captionHidden && 'sr-only')}>{caption}</caption>
        <thead className="sticky top-0 z-[1] bg-tone">
          <tr className="border-b border-rule-strong">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  'px-2 pb-2.5 pt-1 font-text text-label font-[650] uppercase text-fg-3 first:pl-0 last:pr-0 sm:px-3',
                  (c.numeric || c.align === 'end') && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.hideBelow && HIDE[c.hideBelow],
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-fg-2">{empty ?? 'No rows to show.'}</td>
            </tr>
          )}
          {rows.map((row, i) => {
            const on = highlight?.(row) ?? false;
            const stripe = normalizeHex(accent?.(row));
            return (
              <tr key={rowKey(row, i)} className={cn('relative border-b border-rule transition-colors hover:bg-tone-hover', on && 'bg-tone-raised')}>
                {columns.map((c, ci) => {
                  const Cell = c.rowHeader ? 'th' : 'td';
                  return (
                    <Cell
                      key={c.key}
                      scope={c.rowHeader ? 'row' : undefined}
                      className={cn(
                        'px-2 align-middle font-normal text-fg first:pl-0 last:pr-0 sm:px-3',
                        pad,
                        (c.numeric || c.align === 'end') && 'text-right',
                        c.align === 'center' && 'text-center',
                        c.hideBelow && HIDE[c.hideBelow],
                        ci === 0 && stripe && 'pl-3 first:pl-3',
                        on && 'shadow-[inset_0_2px_0_var(--color-brand-red)]',
                      )}
                    >
                      {ci === 0 && stripe && (
                        <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px]" style={{ backgroundColor: stripe }} />
                      )}
                      {c.cell(row, i)}
                      {ci === 0 && on && highlightLabel && <span className="sr-only"> ({highlightLabel})</span>}
                    </Cell>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
