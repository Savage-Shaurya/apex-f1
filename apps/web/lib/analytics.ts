/**
 * Central PostHog event and consent helpers.
 * Client events require an explicit saved choice. Server callers must pass
 * verified visitor consent; adding an analytics key alone enables no capture.
 */

export type EventName =
  | 'pageview'
  | 'nav_click'
  | 'article_card_click'
  | 'video_play'
  | 'race_ticker_click'
  | 'standings_view_all'
  | 'commerce_click'
  | 'load_more'
  | 'search'
  | 'filter_change'
  | 'embed_view'
  | 'newsletter_subscribe'
  | 'apex_plus_interest'
  | 'live_session_join'
  | 'live_session_leave';

export interface EventProps {
  [k: string]: string | number | boolean | undefined | null;
}

export const CONSENT_STORAGE_KEY = 'apex.consent.v1';
export const CONSENT_CHANGED_EVENT = 'apex:consent-changed';

export interface ConsentPreferences {
  analytics: boolean;
  marketing: boolean;
  ts: string;
}

// A failed withdrawal must still stop this tab even if storage is unavailable.
let denyAnalyticsForSession = false;

function isConsentPreferences(value: unknown): value is ConsentPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const consent = value as Partial<ConsentPreferences>;
  return typeof consent.analytics === 'boolean' &&
    typeof consent.marketing === 'boolean' &&
    typeof consent.ts === 'string' &&
    Number.isFinite(Date.parse(consent.ts));
}

/** Read only explicit, valid consent; unavailable storage fails closed. */
export function getConsent(): ConsentPreferences | null {
  if (typeof window === 'undefined') return null;
  if (denyAnalyticsForSession) return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    const consent: unknown = raw === null ? null : JSON.parse(raw);
    if (!isConsentPreferences(consent)) return null;
    return { analytics: consent.analytics, marketing: consent.marketing, ts: consent.ts };
  } catch {
    return null;
  }
}

export function hasAnalyticsConsent(): boolean {
  return getConsent()?.analytics === true;
}

type PostHogClient = {
  capture?: (event: string, props: EventProps) => void;
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  has_opted_out_capturing?: () => boolean;
};

/** Synchronize an already loaded SDK; this does not persist user preferences. */
export function setAnalyticsConsent(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const ph = (window as unknown as { posthog?: PostHogClient }).posthog;
    let optedOut: boolean | undefined;
    try {
      optedOut = ph?.has_opted_out_capturing?.();
    } catch {
      // A broken status probe must not prevent an attempted withdrawal.
    }
    if (enabled && hasAnalyticsConsent()) {
      if (optedOut !== false) ph?.opt_in_capturing?.();
    } else if (optedOut !== true) {
      ph?.opt_out_capturing?.();
    }
  } catch {
    // Consent controls must remain usable when a third-party SDK fails.
  }
}

/** Persist an explicit choice and notify the current tab immediately. */
export function saveConsent(value: ConsentPreferences): boolean {
  if (typeof window === 'undefined' || !isConsentPreferences(value)) return false;
  let persisted = false;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      analytics: value.analytics, marketing: value.marketing, ts: value.ts,
    }));
    persisted = true;
    denyAnalyticsForSession = false;
  } catch {
    denyAnalyticsForSession = true;
  }
  setAnalyticsConsent(persisted && value.analytics);
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
  return persisted;
}

/** Same-tab choices and cross-tab changes share the same update mechanism. */
export function subscribeToConsentChanges(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const notify = () => {
    setAnalyticsConsent(hasAnalyticsConsent());
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) notify();
  };
  window.addEventListener(CONSENT_CHANGED_EVENT, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Server events require consent established by the caller's trusted context. */
export async function captureServer(
  event: EventName,
  props: EventProps = {},
  options: { analyticsConsent: boolean } = { analyticsConsent: false },
) {
  if (options?.analyticsConsent !== true) return;
  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST ?? 'https://app.posthog.com';
  if (!key) return; // no-op until provisioned

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: props.distinct_id ?? 'anonymous',
        timestamp: new Date().toISOString(),
        properties: { ...props, source: 'apex-web-server' },
      }),
      // Don't block requests on analytics · short timeout
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // analytics must never throw
  }
}

/** Client-side event capture. */
export function captureClient(event: EventName, props: EventProps = {}) {
  if (typeof window === 'undefined' || !hasAnalyticsConsent()) return;
  try {
    const ph = (window as unknown as { posthog?: PostHogClient }).posthog;
    ph?.capture?.(event, props);
  } catch {
    // Analytics must not interrupt a visitor's action.
  }
}
