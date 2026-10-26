import { newsletterFailureFeedback, type NewsletterSubmission } from '@/lib/newsletter-submission';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side check before any request: says what to fix, or null when the address looks sendable. */
export function emailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your email address.';
  if (!EMAIL.test(trimmed)) return 'Enter a full email address, like name@example.com.';
  return null;
}

/**
 * What the form says after the subscription service answers. Success is only
 * claimed when the service accepted the address (`accepted`); an unconfirmed
 * outcome is stated as unconfirmed, never as a success or a failure.
 */
export function submissionMessage(result: NewsletterSubmission): { kind: 'success' | 'error' | 'uncertain' | 'none'; text: string } {
  if (result.kind === 'accepted') {
    if (result.duplicate) return { kind: 'success', text: 'You are already subscribed. Nothing else to do.' };
    if (result.welcomeStatus === 'sent') return { kind: 'success', text: 'Subscribed. A welcome email is on its way; check your inbox.' };
    return { kind: 'success', text: 'Subscribed. The welcome email could not be sent, but your subscription is saved.' };
  }
  if (result.kind === 'cancelled') return { kind: 'none', text: '' };
  return { kind: result.kind === 'uncertain' ? 'uncertain' : 'error', text: newsletterFailureFeedback(result) };
}

const WEEK_MS = 7 * 86_400_000;
/** Mirrors the newsletter-blast cron: Fridays 06:00 UTC (vercel.json "0 6 * * 5"), sent when a race starts within 8 days. */
export const BRIEFING_WINDOW_MS = 8 * 86_400_000;

/** The next Friday 06:00 UTC at or after `now`. */
export function nextFridaySlot(now: number): number {
  const d = new Date(now);
  const daysAhead = (5 - d.getUTCDay() + 7) % 7;
  let slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysAhead, 6, 0, 0);
  if (slot < now) slot += WEEK_MS;
  return slot;
}

/**
 * When the next edition is due and which race it covers, using the same rule
 * as the sending job. Returns null when no scheduled race is left to cover
 * (for example after the season finale, before next year's calendar exists).
 */
export function nextBriefing<R extends { raceStartIso: string }>(now: number, races: readonly R[]): { sendAt: number; race: R } | null {
  const upcoming = races
    .map((race) => ({ race, start: Date.parse(race.raceStartIso) }))
    .filter((r) => Number.isFinite(r.start) && r.start > now)
    .sort((a, b) => a.start - b.start);
  if (!upcoming.length) return null;
  let slot = nextFridaySlot(now);
  const last = upcoming.at(-1)!.start;
  while (slot < last) {
    const covered = upcoming.find((r) => r.start > slot && r.start - slot < BRIEFING_WINDOW_MS);
    if (covered) return { sendAt: slot, race: covered.race };
    slot += WEEK_MS;
  }
  return null;
}
