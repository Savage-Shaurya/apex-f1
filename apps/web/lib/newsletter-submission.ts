export const NEWSLETTER_SUBMISSION_DEADLINE_MS = 20_000;

export type NewsletterSubmission =
  | { kind: 'accepted'; duplicate: boolean; welcomeStatus: 'sent' | 'failed' | 'unavailable' }
  | { kind: 'rejected'; status: number }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'invalid-response' }
  | { kind: 'cancelled' };

/** One attempt only. A missing response cannot establish whether storage succeeded. */
export async function submitNewsletter(
  email: string,
  { signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<NewsletterSubmission> {
  if (signal?.aborted) return { kind: 'cancelled' };
  const controller = new AbortController();
  let timedOut = false;
  let completeAbort: (result: NewsletterSubmission) => void = () => {};
  const aborted = new Promise<NewsletterSubmission>((resolve) => { completeAbort = resolve; });
  const onAbort = () => completeAbort(timedOut
    ? { kind: 'uncertain', reason: 'timeout' }
    : { kind: 'cancelled' });
  const cancel = () => controller.abort();
  controller.signal.addEventListener('abort', onAbort, { once: true });
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, NEWSLETTER_SUBMISSION_DEADLINE_MS);

  const request = async (): Promise<NewsletterSubmission> => {
    try {
      const response = await fetchImpl('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
        signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return { kind: 'rejected', status: response.status };
      }
      let payload: unknown;
      try { payload = await response.json(); }
      catch { return { kind: 'uncertain', reason: 'invalid-response' }; }
      if (!payload || typeof payload !== 'object' || !('ok' in payload)
        || payload.ok !== true || !('mode' in payload) || payload.mode !== 'resend') {
        return { kind: 'uncertain', reason: 'invalid-response' };
      }
      return {
        kind: 'accepted',
        duplicate: 'duplicate' in payload && payload.duplicate === true,
        welcomeStatus: 'welcomeStatus' in payload && payload.welcomeStatus === 'sent' ? 'sent'
          : 'welcomeStatus' in payload && payload.welcomeStatus === 'failed' ? 'failed' : 'unavailable',
      };
    } catch {
      return controller.signal.aborted
        ? timedOut ? { kind: 'uncertain', reason: 'timeout' } : { kind: 'cancelled' }
        : { kind: 'uncertain', reason: 'network' };
    }
  };

  try { return await Promise.race([request(), aborted]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

export function newsletterFailureFeedback(result: Exclude<NewsletterSubmission, { kind: 'accepted' }>): string {
  if (result.kind === 'uncertain') {
    return result.reason === 'timeout'
      ? 'The subscription service took too long to reply. Your subscription may have completed; we could not confirm it. Check your inbox before trying again.'
      : 'We could not confirm the subscription response. Your subscription may have completed. Check your connection and inbox before trying again.';
  }
  if (result.kind === 'cancelled') return '';
  return result.status === 400 ? 'Please check your email address.'
    : result.status === 429 ? 'Too many attempts. Wait a little and try again.'
      : 'Newsletter signup is temporarily unavailable. Please try again later.';
}
