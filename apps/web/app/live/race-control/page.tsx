import type { Metadata } from 'next';
import { openf1, type OpenF1RaceControlMessage } from '@apex/api-client/openf1';
import { Container, Label, SourceNote, Unavailable, type FlagKind } from '@/components/ds';
import { SectionTitle } from '@/components/info/carbon';
import { failureReason, loadSheet, settle } from '@/components/live/sheet';
import { OtherScreens, SheetFrame, SheetUnavailable } from '@/components/live/SheetFrame';
import { RaceControlLog, type LogRow } from '@/components/live/RaceControlLog';
import { BAND_LABEL, bandExtent, bandWindow, chequeredFlags, flagBand, flagWords, idleShare, messageGroup, runningPeriods, yellowMoments, type BandKind } from '@/components/live/race-control-model';
import { isQualiKind, offsetMinutes, utcSeconds } from '@/components/live/sheet-model';
import { withSocial } from '@/lib/page-metadata';

type Props = { searchParams: Promise<{ session?: string | string[] }> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state !== 'ready') return withSocial({ title: 'Race control log', description: 'Race control messages of the latest finished Formula 1 session.', alternates: { canonical: '/live/race-control' } });
  return withSocial({
    title: `${ctx.title} ${ctx.season}: ${ctx.session.session_name} race control log`,
    description: `Every race control message of the ${ctx.season} ${ctx.title} ${ctx.session.session_name.toLowerCase()}: flags, safety cars and stewards' decisions.`,
    alternates: { canonical: '/live/race-control' },
  });
}

const FLAG_KIND: Record<string, FlagKind> = {
  GREEN: 'green', YELLOW: 'yellow', 'DOUBLE YELLOW': 'double-yellow', RED: 'red', BLUE: 'blue', CHEQUERED: 'chequered',
};
/** Safety car solid amber; virtual safety car amber in stripes, so the two never read as one; red flag solid red. */
const BAND_FILL: Record<BandKind, string> = {
  sc: 'var(--color-flag-sc)',
  vsc: 'repeating-linear-gradient(90deg, var(--color-flag-sc) 0 3px, #2a2116 3px 6px)',
  red: 'var(--color-flag-red)',
};
/** No session running (before the start, between segments, after the flag): a hatch, so it never reads as a lighter or darker "running". */
const IDLE = 'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.1) 0 1.5px, transparent 1.5px 7px)';
const RUNNING = '#55555c'; // solid, so the idle hatch never shows through
const CHEQUER = 'repeating-conic-gradient(#f4f4f5 0 25%, #0b0b0c 0 50%) 0 0 / 6px 6px';

function localClock(iso: string, gmt: string): string | null {
  const off = offsetMinutes(gmt);
  const t = Date.parse(iso);
  if (off == null || !Number.isFinite(t)) return null;
  return new Date(t + off * 60_000).toISOString().slice(11, 16);
}

export default async function RaceControlPage({ searchParams }: Props) {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state === 'unavailable') return <SheetUnavailable screen="race-control" title="Race control" reason={ctx.reason} cause={ctx.cause} liveNow={ctx.liveNow} next={ctx.next} requested={ctx.requested} />;
  if (ctx.state === 'none') return <SheetUnavailable screen="race-control" title="Race control" reason={ctx.notice} liveNow={ctx.liveNow} next={ctx.next} />;

  const { session } = ctx;
  const read = await settle(() => openf1.getRaceControl(session.session_key, { strict: true, timeoutMs: 8_000, revalidate: 3600 }), [] as OpenF1RaceControlMessage[]);
  const messages = read.value;
  const ok = read.ok;
  const sorted = [...messages].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const rows: LogRow[] = sorted.map((m, i) => {
    const flag = m.flag?.toUpperCase().replace(/_/g, ' ') ?? null;
    const sc = m.category === 'SafetyCar' ? (/\bVSC\b|VIRTUAL/i.test(m.message) ? 'virtual-safety-car' : 'safety-car') : null;
    return {
      id: `${m.date}-${i}`,
      utc: utcSeconds(m.date),
      local: localClock(m.date, session.gmt_offset),
      lap: m.lap_number ?? null,
      group: messageGroup(m),
      category: m.category,
      flag: (sc as FlagKind | null) ?? (flag ? FLAG_KIND[flag] ?? null : null),
      flagWords: flag && !FLAG_KIND[flag] ? flagWords(flag) : null,
      message: m.message,
    };
  });
  const win = bandWindow(sorted, Date.parse(session.date_start), Date.parse(session.date_end));
  const band = flagBand(sorted, win.end);
  const extent = bandExtent(band.marks, band.periods, win.end);
  const span = Math.max(1, extent - win.start);
  const flags = chequeredFlags(sorted).filter((t) => t > win.start && t <= win.end);
  // The flag that ends the band, unless a chequered message already sits within a minute of it.
  if (!flags.some((t) => Math.abs(t - win.end) < 60_000)) flags.push(win.end);
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - win.start) / span) * 100));
  const minutes = Math.round((win.end - win.start) / 60_000);
  const kinds = [...new Set(band.periods.map((p) => p.kind))];
  const logged = runningPeriods(sorted, win.end);
  // No session status messages: the window itself runs from the start to the flag.
  const running = logged.length ? logged : [{ from: win.start, to: win.end }];
  const showsIdle = idleShare(running, win.start, extent) > 0.004;
  const moments = yellowMoments(band.marks);
  const hasLaps = rows.some((r) => r.lap != null);
  const segPrefix = ctx.kind === 'sprint-qualifying' ? 'SQ' : 'Q';
  const segments = isQualiKind(ctx.kind) && running.length >= 2 && running.length <= 3 ? running : [];
  const yellowCount = band.marks.length;
  const lateYellows = band.marks.filter((m) => m.at > win.end).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const yellowNote = [
    moments.length === yellowCount ? plural(yellowCount, 'message', 'messages') : `${plural(yellowCount, 'message', 'messages')} at ${plural(moments.length, 'moment', 'moments')}`,
    lateYellows === 0 ? null : lateYellows === yellowCount ? 'after the flag' : `${lateYellows} after the flag`,
  ].filter(Boolean).join(', ');

  return (
    <SheetFrame ctx={ctx} screen="race-control">
      <section aria-labelledby="band-title" className="bc-carbon border-b border-[color:var(--bc-rule)] py-16 md:py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <SectionTitle id="band-title" size="s" eyebrow="Start to flag" title="The session in flags" />
            <p className="bc-label text-[color:var(--bc-titanium)]">From race control messages · {minutes} minutes</p>
          </div>
          {ok && sorted.length > 0 ? (
            <figure className="bcp-panel mt-10 p-4 sm:p-6 md:p-8">
              {segments.length > 0 && (
                <div aria-hidden className="relative mb-2 h-5">
                  {segments.map((g, i) => (
                    <span key={i} className="absolute top-0 font-text text-caption font-[650] text-fg-2" style={{ left: `${pos(g.from)}%` }}>{segPrefix}{i + 1}</span>
                  ))}
                </div>
              )}
              <div className="relative h-12 ring-1 ring-inset ring-[var(--rule)]" style={{ background: IDLE }} role="img" aria-label={
                band.periods.length || yellowCount
                  ? `${band.periods.map((p) => `${BAND_LABEL[p.kind]}${p.openLap ? ` from lap ${p.openLap}` : ''}${p.closeLap ? ` to lap ${p.closeLap}` : ''}`).join('; ')}${band.periods.length && yellowCount ? '; ' : ''}${yellowCount ? `${yellowCount} sector yellow ${yellowCount === 1 ? 'flag' : 'flags'}${lateYellows ? `, ${lateYellows === yellowCount ? 'all' : lateYellows} after the chequered flag` : ''}` : ''}.`
                  : 'No safety car, red flag or yellow flag was shown.'
              }>
                {running.map((g, i) => (
                  <span key={`r${i}`} className="absolute inset-y-0" style={{ left: `${pos(g.from)}%`, width: `${pos(g.to) - pos(g.from)}%`, backgroundColor: RUNNING }} />
                ))}
                {band.periods.map((p, i) => (
                  <span key={i} className="absolute inset-y-0" style={{ left: `${pos(p.from)}%`, width: `max(4px, ${pos(p.to) - pos(p.from)}%)`, background: BAND_FILL[p.kind] }} />
                ))}
                {flags.map((t) => (
                  <span key={`c${t}`} aria-hidden className="absolute inset-y-0 w-2 -translate-x-full" style={{ left: `${pos(t)}%`, background: CHEQUER }} />
                ))}
              </div>
              {/* Sector yellows get their own lane under the band, so they never sit on (or blend into) the amber of a safety car. */}
              {moments.length > 0 && (
                <div aria-hidden className="relative mt-1.5 h-4">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--rule)]" />
                  {moments.map((m) => (
                    <span
                      key={m.at}
                      className={m.count > 1 ? 'absolute inset-y-0 w-1.5 -translate-x-1/2 bg-flag-yellow' : 'absolute inset-y-0.5 w-1 -translate-x-1/2 bg-flag-yellow'}
                      style={{ left: `${pos(m.at)}%` }}
                    />
                  ))}
                </div>
              )}
              <div aria-hidden className="mt-2 flex flex-wrap justify-between gap-x-4 font-text text-caption text-fg-3">
                <span>Start {utcSeconds(new Date(win.start).toISOString()).slice(0, 5)} UTC</span>
                <span>Flag {utcSeconds(new Date(win.end).toISOString()).slice(0, 5)} UTC{extent > win.end ? `, cool-down to ${utcSeconds(new Date(extent).toISOString()).slice(0, 5)}` : ''}</span>
              </div>
              <figcaption className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-text text-small text-fg-2">
                <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-5" style={{ backgroundColor: RUNNING }} />Session running</span>
                {showsIdle && <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-5 ring-1 ring-inset ring-[var(--rule)]" style={{ background: IDLE }} />{segments.length > 0 ? 'Between segments or after the flag' : 'Not running'}</span>}
                {kinds.map((k) => (
                  <span key={k} className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-5" style={{ background: BAND_FILL[k] }} />{BAND_LABEL[k]}</span>
                ))}
                {yellowCount > 0 && <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-1 bg-flag-yellow" />Sector yellow, lane below ({yellowNote})</span>}
                {!kinds.length && !yellowCount && <span>No safety car, red flag or yellow flag was shown.</span>}
                <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-2" style={{ background: CHEQUER }} />Chequered flag{flags.length > 1 ? ` (${flags.length})` : ''}</span>
              </figcaption>
            </figure>
          ) : null}
        </Container>
      </section>

      <section aria-labelledby="log-title" className="py-20 md:py-28">
        <Container>
          <div className="max-w-[64rem]">
            <SectionTitle id="log-title" eyebrow="Every message" title="Message log">
              Messages exactly as race control sent them, in capitals{hasLaps ? ', with the lap they were sent on' : ''}. Times are UTC and circuit time.
              {!hasLaps && rows.length > 0 ? ' Lap numbers are not available for this session’s messages.' : ''}
            </SectionTitle>
            <div className="mt-10">
              {!ok ? (
                <Unavailable title="Race control log unavailable">{failureReason(read.cause ?? 'network', 'the race control log')}</Unavailable>
              ) : rows.length === 0 ? (
                <div className="bcp-panel p-7"><p className="bc-wide text-[1.3rem] text-white">No messages</p><p className="mt-2 text-[color:var(--bc-silver)]">There are no race control messages for this session.</p></div>
              ) : (
                <RaceControlLog rows={rows} />
              )}
            </div>
            <div className="bcp-panel bcp-panel--flat mt-12 grid gap-6 p-6 sm:grid-cols-2 md:p-8">
              <div>
                <Label as="p">Flags you may see</Label>
                <dl className="mt-3 grid gap-2 font-text text-small text-fg-2">
                  <div><dt className="inline font-[650] text-fg">Blue: </dt><dd className="inline">let a faster car through.</dd></div>
                  <div><dt className="inline font-[650] text-fg">Yellow / double yellow: </dt><dd className="inline">danger in that sector, slow down, no overtaking.</dd></div>
                  <div><dt className="inline font-[650] text-fg">Black and white: </dt><dd className="inline">a warning for unsporting behaviour or track limits.</dd></div>
                  <div><dt className="inline font-[650] text-fg">Clear: </dt><dd className="inline">the hazard has passed.</dd></div>
                </dl>
              </div>
              <SourceNote updated={`${rows.length} messages`} />
            </div>
          </div>
        </Container>
      </section>
      <OtherScreens current="race-control" sessionKey={session.session_key} />
    </SheetFrame>
  );
}
