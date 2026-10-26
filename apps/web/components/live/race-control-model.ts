/**
 * Race-control log model: grouping for filters and the session flag band.
 * Everything is derived from OpenF1 race_control messages as sent; periods
 * are only drawn where a message opens and another closes them.
 */

export interface RcMessage {
  date: string;
  category: string;
  flag?: string | null;
  message: string;
  scope?: string | null;
  sector?: number | null;
  lap_number?: number | null;
  driver_number?: number | null;
}

export type RcGroup = 'flags' | 'blue' | 'safety-car' | 'stewards' | 'session' | 'other';

export const GROUP_LABEL: Record<RcGroup, string> = {
  flags: 'Flags',
  blue: 'Blue flags',
  'safety-car': 'Safety car',
  stewards: 'Stewards',
  session: 'Session',
  other: 'Other notes',
};

export function messageGroup(m: RcMessage): RcGroup {
  const flag = m.flag?.toUpperCase() ?? '';
  if (m.category === 'Flag') return flag === 'BLUE' ? 'blue' : 'flags';
  if (m.category === 'SafetyCar') return 'safety-car';
  if (m.category === 'SessionStatus') return 'session';
  if (/^FIA STEWARDS/i.test(m.message)) return 'stewards';
  return 'other';
}

/** Flag name as words for any OpenF1 flag value ("BLACK AND WHITE" -> "Black and white"). */
export function flagWords(flag: string): string {
  const f = flag.trim().toLowerCase().replace(/_/g, ' ');
  return f.charAt(0).toUpperCase() + f.slice(1);
}

export type BandKind = 'sc' | 'vsc' | 'red';
export interface BandPeriod { kind: BandKind; from: number; to: number; openLap: number | null; closeLap: number | null }
export interface BandMark { at: number; kind: 'yellow' | 'double-yellow'; sector: number | null }

export const BAND_LABEL: Record<BandKind, string> = { sc: 'Safety car', vsc: 'Virtual safety car', red: 'Red flag' };

/**
 * Track-wide neutralisations as periods, sector yellows as marks. A period
 * left open at the end of the log closes at the session's end and is still
 * drawn, because the stewards never closed it before the flag.
 */
export function flagBand(messages: readonly RcMessage[], sessionEnd: number): { periods: BandPeriod[]; marks: BandMark[] } {
  const sorted = [...messages].filter((m) => Number.isFinite(Date.parse(m.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const periods: BandPeriod[] = [];
  const marks: BandMark[] = [];
  let open: { kind: BandKind; from: number; lap: number | null } | null = null;
  const close = (at: number, lap: number | null) => {
    if (open) periods.push({ kind: open.kind, from: open.from, to: at, openLap: open.lap, closeLap: lap });
    open = null;
  };
  for (const m of sorted) {
    const at = Date.parse(m.date);
    const text = m.message.toUpperCase();
    const flag = m.flag?.toUpperCase() ?? '';
    const lap = m.lap_number ?? null;
    if (m.category === 'SafetyCar') {
      const vsc = /\bVSC\b|VIRTUAL SAFETY CAR/.test(text);
      if (/DEPLOYED/.test(text)) {
        if (open) close(at, lap);
        open = { kind: vsc ? 'vsc' : 'sc', from: at, lap };
      } else if (open && /ENDING|IN THIS LAP|WITHDRAWN/.test(text)) {
        close(at, lap);
      }
    } else if (m.category === 'Flag' && (m.scope ?? '').toLowerCase() === 'track') {
      if (flag === 'RED') {
        if (open) close(at, lap);
        open = { kind: 'red', from: at, lap };
      } else if (open && (flag === 'GREEN' || flag === 'CLEAR' || flag === 'CHEQUERED')) {
        close(at, lap);
      }
    } else if (m.category === 'SessionStatus' && open?.kind === 'red' && /RESUMED|STARTED/.test(text)) {
      close(at, lap);
    } else if (m.category === 'Flag' && (flag === 'YELLOW' || flag === 'DOUBLE YELLOW')) {
      marks.push({ at, kind: flag === 'YELLOW' ? 'yellow' : 'double-yellow', sector: m.sector ?? null });
    }
  }
  if (open) close(Math.max(sessionEnd, (open as { from: number }).from), null);
  return { periods, marks };
}

/** Session window for the band: first "SESSION STARTED" (else scheduled start) to the chequered flag (else scheduled end). */
export function bandWindow(messages: readonly RcMessage[], scheduledStart: number, scheduledEnd: number): { start: number; end: number } {
  const t = (m: RcMessage) => Date.parse(m.date);
  const started = messages.filter((m) => m.category === 'SessionStatus' && /STARTED/i.test(m.message)).map(t).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const finished = messages.filter((m) => (m.category === 'Flag' && m.flag?.toUpperCase() === 'CHEQUERED') || (m.category === 'SessionStatus' && /FINISHED/i.test(m.message))).map(t).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const start = started ?? scheduledStart;
  const end = finished && finished > start ? finished : Math.max(scheduledEnd, start + 60_000);
  return { start, end };
}

/** Running periods from SESSION STARTED / FINISHED pairs (qualifying has one per segment). */
export function runningPeriods(messages: readonly RcMessage[], end: number): Array<{ from: number; to: number }> {
  const status = messages
    .filter((m) => m.category === 'SessionStatus' && Number.isFinite(Date.parse(m.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const out: Array<{ from: number; to: number }> = [];
  let from: number | null = null;
  for (const m of status) {
    const at = Date.parse(m.date);
    if (/STARTED|RESUMED/i.test(m.message)) { if (from === null) from = at; }
    else if (/FINISHED|ENDED|SUSPENDED|INACTIVE/i.test(m.message) && from !== null) { out.push({ from, to: at }); from = null; }
  }
  if (from !== null) out.push({ from, to: Math.max(end, from) });
  return out;
}

/**
 * Right edge of the drawn band. Normally the chequered flag, but flags shown
 * on the cool-down lap (after the flag) are real messages too, so the band
 * runs on to just past the last of them (at most 20 minutes) instead of
 * hiding them behind the chequered mark.
 */
export function bandExtent(marks: readonly BandMark[], periods: readonly BandPeriod[], flagAt: number): number {
  const limit = flagAt + 20 * 60_000;
  const late = [...marks.map((m) => m.at), ...periods.map((p) => p.to)].filter((t) => t > flagAt && t <= limit);
  if (late.length === 0) return flagAt;
  return Math.min(limit, Math.max(...late) + 60_000);
}

/** Chequered flags shown on the track (one per qualifying segment), oldest first. */
export function chequeredFlags(messages: readonly RcMessage[]): number[] {
  return messages
    .filter((m) => m.category === 'Flag' && m.flag?.toUpperCase() === 'CHEQUERED')
    .map((m) => Date.parse(m.date))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/**
 * Sector yellows grouped by the moment they were shown: race control often
 * sends several sector messages with one timestamp, which draw as a single
 * mark. Marks within `withinMs` of each other merge.
 */
export function yellowMoments(marks: readonly BandMark[], withinMs = 1_000): Array<{ at: number; count: number; double: boolean }> {
  const out: Array<{ at: number; count: number; double: boolean }> = [];
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (last && m.at - last.at <= withinMs) {
      last.count += 1;
      last.double ||= m.kind === 'double-yellow';
    } else {
      out.push({ at: m.at, count: 1, double: m.kind === 'double-yellow' });
    }
  }
  return out;
}

/** Share of [from, to] that no running period covers (0 = always running). */
export function idleShare(running: ReadonlyArray<{ from: number; to: number }>, from: number, to: number): number {
  const span = to - from;
  if (!(span > 0)) return 0;
  let covered = 0;
  let cursor = from;
  for (const r of [...running].sort((a, b) => a.from - b.from)) {
    const a = Math.max(cursor, r.from, from);
    const b = Math.min(r.to, to);
    if (b > a) { covered += b - a; cursor = b; }
  }
  return Math.max(0, 1 - covered / span);
}
