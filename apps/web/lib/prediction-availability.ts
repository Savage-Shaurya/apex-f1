export interface PredictionAvailabilityInput {
  available: boolean;
  lockTimestamp?: number;
  now: number;
  serverLocked?: boolean;
  /** Why writes are unavailable: no database is connected, or the service failed. */
  reason?: 'database' | 'service';
}

/** A service failure must disable writes without inventing a qualifying start. */
export function getPredictionAvailability({ available, lockTimestamp, now, serverLocked = false, reason = 'service' }: PredictionAvailabilityInput) {
  const deadlineKnown = lockTimestamp != null && Number.isFinite(lockTimestamp) && lockTimestamp > 0;
  if (serverLocked || (deadlineKnown && now >= lockTimestamp)) {
    return {
      kind: 'locked' as const,
      disabled: true,
      label: 'PICKS LOCKED',
      message: serverLocked
        ? 'Picks are locked for this race.'
        : 'Qualifying has started. Picks can no longer be changed.',
    };
  }
  if (!deadlineKnown || !available) {
    return {
      kind: 'unavailable' as const,
      disabled: true,
      label: 'PREDICTIONS UNAVAILABLE',
      message: !deadlineKnown
        ? 'The official qualifying deadline is not available yet. Picks cannot be saved until it is confirmed.'
        : reason === 'database'
          ? 'Predictions can’t be saved just yet. Your choices are still here, ready for when saving returns.'
          : 'Predictions are temporarily unavailable. Your choices are still here. Please try again shortly.',
    };
  }
  return { kind: 'open' as const, disabled: false, label: null, message: '' };
}
