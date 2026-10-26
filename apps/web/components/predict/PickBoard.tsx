'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';
import { Button, Icon, Label, Media, StatusBadge, Text, TextLink } from '@/components/ds';
import { transition } from '@/components/motion/tokens';
import { PREDICT_QUESTIONS, PREDICT_MAX } from '@/lib/predict';
import { predictionFailureFeedback, submitPrediction } from '@/lib/prediction-submission';
import { getPredictionAvailability } from '@/lib/prediction-availability';
import { DriverSheet, type PickDriver } from './DriverSheet';

const ASK: Record<string, string> = {
  pole: 'Who takes pole position?',
  winner: 'Who wins the race?',
  podium: 'Name one driver who finishes on the podium',
  fastest_lap: 'Who sets the fastest lap?',
};
const SHEET_TITLE: Record<string, string> = {
  pole: 'Pick pole position',
  winner: 'Pick the race winner',
  podium: 'Pick a podium finisher',
  fastest_lap: 'Pick the fastest lap',
};

/**
 * The pick board. Four calls on the real grid, each chosen in the driver
 * sheet; one primary action saves them through the signed prediction API.
 * Success is only claimed when the API returns a saved revision.
 */
export function PickBoard({
  raceName,
  raceSlug,
  season,
  round,
  isAvailable,
  unavailableReason,
  checkedAt,
  lockTimestamp,
  lockLabel,
  drivers,
  initialPicks,
  initialRevision,
}: {
  lockLabel?: string | null;
  raceName: string;
  raceSlug: string;
  season: number;
  round: number;
  isAvailable: boolean;
  unavailableReason?: 'database' | 'service';
  checkedAt: number;
  lockTimestamp?: number;
  drivers: PickDriver[];
  initialPicks: Record<string, string>;
  initialRevision: string | null;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const formId = useId();
  const [picks, setPicks] = useState<Record<string, string>>(initialPicks);
  const [savedRevision, setSavedRevision] = useState<string | null>(initialRevision);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [deadlineCheckedAt, setDeadlineCheckedAt] = useState(checkedAt);
  const [serverLocked, setServerLocked] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const availability = getPredictionAvailability({ available: isAvailable && drivers.length > 0, reason: unavailableReason, lockTimestamp, now: deadlineCheckedAt, serverLocked });
  const locked = availability.kind === 'locked';

  // Re-check the real deadline exactly when it passes (qualifying start).
  useEffect(() => {
    if (lockTimestamp == null || !Number.isFinite(lockTimestamp) || lockTimestamp <= 0) return;
    let timeout = 0;
    const check = () => {
      const current = Date.now();
      setDeadlineCheckedAt(current);
      const remaining = lockTimestamp - current;
      if (remaining > 0) timeout = window.setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => window.clearTimeout(timeout);
  }, [lockTimestamp, checkedAt]);

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const now = Date.now();
    const current = getPredictionAvailability({ available: isAvailable && drivers.length > 0, reason: unavailableReason, lockTimestamp, now, serverLocked });
    if (current.disabled) { setDeadlineCheckedAt(now); setError(current.message); setState('error'); return; }
    const controller = new AbortController();
    request.current = controller;
    setState('saving'); setError('');
    const result = await submitPrediction({ season, round, raceSlug, picks, expectedRevision: savedRevision }, { signal: controller.signal });
    if (controller.signal.aborted || request.current !== controller) return;
    request.current = null;
    if (result.kind === 'accepted') {
      setSavedRevision(result.revision); setState('saved'); router.refresh();
    } else {
      if (result.kind === 'rejected' && result.status === 409) setServerLocked(true);
      setError(predictionFailureFeedback(result)); setState('error');
    }
  }

  const byId = new Map(drivers.map((d) => [d.id, d] as const));
  const filled = PREDICT_QUESTIONS.filter((q) => picks[q.id]).length;
  const statusId = `${formId}-status`;
  const taken = new Map<string, string>();
  if (sheetFor) for (const q of PREDICT_QUESTIONS) if (q.id !== sheetFor && picks[q.id]) taken.set(picks[q.id]!, q.label);
  const canEdit = !availability.disabled && state !== 'saving';
  const savedAt = savedRevision && Number.isFinite(Date.parse(savedRevision))
    ? new Date(savedRevision).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
    : null;

  if (locked && filled === 0) {
    return (
      <div className="bcp-panel p-6 md:p-10">
        <div className="min-w-0">
          <p className="inline-flex min-h-8 items-center px-3 font-text text-label uppercase text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)]">Picks locked</p>
          <h2 className="mt-5 font-text text-heading-l text-fg [overflow-wrap:anywhere]">Picks are locked for the {raceName}</h2>
          <Text tone="muted" className="mt-3" measure>
            {serverLocked ? 'This race is closed for picks.' : `Qualifying started${lockLabel ? ` on ${lockLabel}` : ''}.`} You made no picks for this race
            from this browser. The next round opens for picks once this race has started.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} aria-describedby={statusId} aria-busy={state === 'saving'}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h2 className="font-display font-normal-width text-display-m uppercase tracking-[0.005em] text-fg text-balance sm:font-semi-wide">
            {locked ? 'Picks locked' : 'Your four calls'}
          </h2>
          <p className="mt-3 font-text text-heading-s text-fg-2 [overflow-wrap:anywhere]">{raceName}</p>
        </div>
        <p className="flex items-center gap-4">
          <span aria-hidden className="flex gap-1.5">
            {PREDICT_QUESTIONS.map((q) => (
              <span key={q.id} className={cn('h-1.5 w-7 rounded-full transition-colors duration-[var(--duration-slow)]', picks[q.id] ? 'bg-brand-red' : 'bg-surface-3')} />
            ))}
          </span>
          <span className="font-text text-ui font-[650] text-fg">{filled} of {PREDICT_QUESTIONS.length} picked</span>
        </p>
      </div>

      <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PREDICT_QUESTIONS.map((q) => {
          const d = picks[q.id] ? byId.get(picks[q.id]!) : undefined;
          return (
            <li key={q.id} className={cn('min-w-0', q.id === 'winner' && 'order-first sm:order-none')}>
              <div className={cn('bcp-panel relative flex h-full flex-col overflow-hidden', q.id === 'winner' && 'shadow-[inset_0_2px_0_var(--bc-red),inset_0_0_0_1px_rgb(255_255_255/0.10)]')}>
                <div className="flex items-start justify-between gap-4 p-5 pb-4">
                  <div className="min-w-0">
                    <Label as="p" tone="default" size="l">{q.label}</Label>
                    <p className="mt-1.5 min-h-[2.96em] font-text text-small text-fg-2">{ASK[q.id]}</p>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="bc-mono block text-[1.9rem] leading-none text-white">{q.points}</span>
                    <span className="mt-1 block font-text text-label uppercase text-fg-3">pts</span>
                  </p>
                </div>
                <div className="relative mx-5 aspect-square overflow-hidden rounded-[14px]">
                  <AnimatePresence mode="wait" initial={false}>
                    {d ? (
                      <m.div key={d.id} className="absolute inset-0" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -8 }} transition={transition.state}>
                        <Media src={d.headshot} alt={d.name} kind="headshot" accent={d.color} sizes="(max-width: 640px) 90vw, (max-width: 1280px) 45vw, 22vw" className="h-full" frameClassName="h-full !aspect-auto" />
                      </m.div>
                    ) : (
                      <m.div key="empty" className="absolute inset-0 flex flex-col items-center justify-center gap-3 shadow-[inset_0_0_0_1px_var(--rule-strong)]" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition.state}>
                        <span aria-hidden className="flex size-14 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--rule-strong)] text-fg-3"><Icon name="plus" size={24} /></span>
                        <span className="font-text text-small text-fg-3">{locked ? 'No pick made' : 'No pick yet'}</span>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex flex-1 flex-col p-5 pt-4">
                  <p className="min-h-[4.75rem]">
                    {d ? (
                      <>
                        <span className="block font-text text-small text-fg-2">{d.firstName}</span>
                        <span className="block font-text text-heading-s font-[700] uppercase text-fg [overflow-wrap:anywhere]">{d.lastName}</span>
                        {d.team && <span className="mt-0.5 block font-text text-caption text-fg-3 [overflow-wrap:anywhere]">{d.team}</span>}
                      </>
                    ) : null}
                  </p>
                  {!locked && <Button
                    variant="secondary"
                    block
                    className="mt-4"
                    disabled={!canEdit}
                    aria-haspopup="dialog"
                    onClick={(e) => { opener.current = e.currentTarget; setSheetFor(q.id); }}
                  >
                    {d ? 'Change pick' : 'Choose a driver'}
                    <span className="sr-only"> for {q.label.toLowerCase()}</span>
                  </Button>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-8 flex flex-col gap-5 pt-8 shadow-[inset_0_1px_0_var(--rule)] md:flex-row md:items-center md:gap-8">
        {!locked && <Button type="submit" size="lg" cut loading={state === 'saving'} disabled={availability.disabled || filled === 0} icon={state === 'saved' ? 'check' : 'arrow-right'}>
          {state === 'saved' ? 'Picks saved' : savedRevision ? 'Update my picks' : 'Save my picks'}
        </Button>}
        <div className="min-w-0">
          {availability.label && <StatusBadge status={locked ? 'finished' : 'unavailable'} className="mb-1.5">{locked ? 'Locked' : 'Not saving'}</StatusBadge>}
          <p id={statusId} role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'} className={cn('max-w-[60ch] font-text text-small [overflow-wrap:anywhere]', state === 'error' ? 'text-accent' : 'text-fg-2')}>
            {state === 'error' ? error
              : state === 'saved' ? `Saved${savedAt ? ` at ${savedAt}` : ''}. You can change them until qualifying starts. Scores appear once the official result is confirmed.`
                : state === 'saving' ? 'Saving your picks.'
                  : availability.message || (savedAt ? `Your picks were last saved at ${savedAt}. ${PREDICT_MAX} points are on the line.` : `${PREDICT_MAX} points are on the line. Nothing is saved until you press save.`)}
          </p>
        </div>
      </div>

      <DriverSheet
        open={sheetFor !== null}
        title={sheetFor ? SHEET_TITLE[sheetFor] ?? 'Pick a driver' : ''}
        drivers={drivers}
        selected={sheetFor ? picks[sheetFor] ?? null : null}
        taken={taken}
        onPick={(id) => {
          if (sheetFor) setPicks((p) => ({ ...p, [sheetFor]: id }));
          setState('idle'); setError(''); setSheetFor(null);
          window.setTimeout(() => opener.current?.focus(), 0);
        }}
        onClose={() => { setSheetFor(null); window.setTimeout(() => opener.current?.focus(), 0); }}
      />
      <Text size="caption" tone="subtle" className="mt-6">Picks are saved with Apex and linked to this browser; there is no account. See the <TextLink href="/legal/privacy">privacy policy</TextLink>.</Text>
    </form>
  );
}
