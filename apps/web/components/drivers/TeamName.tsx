import { TeamMark } from '@/components/ds';

/**
 * A team colour stripe and name that wraps only between words. DS TeamMark
 * sets `overflow-wrap: anywhere` on its name, which lets a squeezed table
 * column split a single word ("Merced/es"); here the name's min-content is
 * its longest word, so a table column grows (or the sheet scrolls) instead.
 * Candidate to promote into ds as a TeamMark `wrap="words"` option.
 */
export function TeamName({ color, name, className }: { color?: string | null; name: string; className?: string }) {
  return (
    <TeamMark color={color} className={className}>
      <span className="min-w-0 [overflow-wrap:normal] [word-break:normal]">{name}</span>
    </TeamMark>
  );
}
