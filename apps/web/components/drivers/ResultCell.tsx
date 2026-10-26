import { resultWords, tookTheFlag, type CareerRace } from './people';

/**
 * One Grand Prix result on a timing sheet. A classified driver who was not
 * running at the flag shows the position with the reason under it, and the
 * screen-reader text says "Classified P20, retired", never "finished".
 */
export function ResultCell({ race }: { race: Pick<CareerRace, 'finish' | 'status' | 'positionText'> }) {
  if (race.finish === null) return <span className="text-fg-2">{race.status || race.positionText || 'Not classified'}</span>;
  const flag = tookTheFlag(race.status);
  return (
    <span className="inline-flex flex-col items-end">
      <span aria-hidden className={race.finish === 1 ? 'font-[750] text-fg' : 'font-[650]'}>P{race.finish}</span>
      {!flag && <span aria-hidden className="font-text text-small text-fg-3">{race.status}</span>}
      <span className="sr-only">{resultWords(race)}{race.finish === 1 ? ' (win)' : ''}</span>
    </span>
  );
}
