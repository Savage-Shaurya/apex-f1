import type { ImageCredit as Credit } from '@/lib/commons-image';

/**
 * Attribution for a Wikimedia Commons photograph: author, licence and a link
 * to the file page, as the CC licences require. Plain server markup.
 */
export function ImageCredit({ credit, className = '' }: { credit: Credit; className?: string }) {
  const link = 'text-fg-2 underline decoration-[var(--rule-strong)] underline-offset-2 hover:text-fg hover:decoration-[var(--accent-text)]';
  return (
    <span className={`inline-block max-w-full whitespace-normal [overflow-wrap:anywhere] font-text text-caption text-fg-3 ${className}`}>
      Photo{' '}
      <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className={link}>
        {credit.author ?? 'Wikimedia Commons contributor'}
      </a>
      {credit.license && (
        <>
          {' · '}
          {credit.licenseUrl ? (
            <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer license" className={link}>{credit.license}</a>
          ) : (
            credit.license
          )}
        </>
      )}
      {' · Wikimedia Commons'}
    </span>
  );
}
