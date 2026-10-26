import { safeErrorMessage } from "./api-input";
import type { EmailTemplate } from "./email-templates";
import { fetchProviderJson } from './provider-json';
import { newsletterDeliveryIdentity, type NewsletterDeliveryIdentity } from '@apex/db';

export interface NewsletterLedger {
  recordNewsletterDeliveryIdentity?(key: string, token: string, identity: NewsletterDeliveryIdentity): Promise<void>;
  reserveNewsletterEdition(
    key: string,
  ): Promise<
    | { status: "acquired"; leaseToken: string; broadcastId: string | null }
    | {
        status: "already-sent" | "in-progress" | "needs-review";
        broadcastId: string | null;
      }
  >;
  markNewsletterCreating(key: string, token: string): Promise<void>;
  recordNewsletterBroadcast(
    key: string,
    id: string,
    token: string,
  ): Promise<void>;
  markNewsletterSending(key: string, token: string): Promise<void>;
  markNewsletterSent(key: string, token: string): Promise<void>;
  markNewsletterFailed(
    key: string,
    reason: string,
    token: string,
    options?: { uncertain?: boolean },
  ): Promise<void>;
}

export class NewsletterDeliveryError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly uncertain = false,
  ) {
    super(message);
  }
}

function rejection(
  response: { status: number },
  action: string,
): NewsletterDeliveryError {
  return new NewsletterDeliveryError(
    `resend broadcast ${action} ${response.status}: provider rejected request`,
    500,
    response.status >= 500 || action === "send",
  );
}

/** No automatic retry of a broadcast whose remote delivery outcome is ambiguous. */
export async function deliverNewsletterEdition(
  input: {
    key: string;
    apiKey: string;
    audienceId: string;
    fromEmail: string;
    fromName: string;
    email: EmailTemplate;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
  ledger: NewsletterLedger,
  fetcher: typeof fetch = fetch,
): Promise<{ status: "sent" | "already-sent"; broadcastId: string | null }> {
  const timeoutMs = input.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8_000) throw new TypeError('Invalid newsletter provider deadline.');
  input.signal?.throwIfAborted();
  const reservation = await ledger.reserveNewsletterEdition(input.key);
  if (reservation.status === "already-sent")
    return { status: "already-sent", broadcastId: reservation.broadcastId };
  if (reservation.status !== "acquired")
    throw new NewsletterDeliveryError(
      `Newsletter edition ${reservation.status}; inspect its durable delivery record before retrying.`,
      409,
    );
  const token = reservation.leaseToken;
  let remoteCreateStarted = false;
  let broadcastId: string | null = null;
  try {
    const payload = { audienceId: input.audienceId, from: `${input.fromName} <${input.fromEmail}>`, subject: input.email.subject,
      html: input.email.html, text: input.email.text, replyTo: [input.fromEmail], topicId: null };
    const identity = newsletterDeliveryIdentity(input.key, payload);
    // Production ledger commits the immutable marker/hash before any provider create.
    await ledger.recordNewsletterDeliveryIdentity?.(input.key, token, identity);
    // A crash after this commit is review-only, even if the remote id was never saved.
    await ledger.markNewsletterCreating(input.key, token);
    remoteCreateStarted = true;
    const headers = {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    };
    const created = await fetchProviderJson("https://api.resend.com/broadcasts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        audience_id: input.audienceId,
        name: identity.providerName,
        from: payload.from,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
        reply_to: payload.replyTo,
      }),
      signal: input.signal,
    }, { timeoutMs, maxBytes: 8_192, fetcher });
    if (!created.ok) throw rejection(created, "create");
    const result: unknown = created.value;
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)
    )
      throw new NewsletterDeliveryError(
        "resend broadcast create returned an invalid id",
        500,
        true,
      );
    broadcastId = result.id;
    await ledger.recordNewsletterBroadcast(input.key, broadcastId, token);
    // Commit before calling send. Timeouts, crashes and failed acknowledgements never resend automatically.
    await ledger.markNewsletterSending(input.key, token);
    const sent = await fetchProviderJson(
      `https://api.resend.com/broadcasts/${encodeURIComponent(broadcastId)}/send`,
      {
        method: "POST",
        headers,
        body: "{}",
        signal: input.signal,
      },
      { timeoutMs, fetcher, readBodyOnSuccess: false },
    );
    if (!sent.ok) throw rejection(sent, "send");
    await ledger.markNewsletterSent(input.key, token);
    return { status: "sent", broadcastId };
  } catch (err) {
    const message = safeErrorMessage(err)
      .split(input.apiKey)
      .join("[redacted]");
    const uncertain =
      broadcastId !== null ||
      (err instanceof NewsletterDeliveryError
        ? err.uncertain
        : remoteCreateStarted);
    try {
      await ledger.markNewsletterFailed(input.key, message, token, {
        uncertain,
      });
    } catch {
      throw new NewsletterDeliveryError(
        `${message}; delivery record could not be updated. Manual reconciliation required.`,
        500,
        true,
      );
    }
    throw new NewsletterDeliveryError(
      message,
      err instanceof NewsletterDeliveryError ? err.status : 500,
      uncertain,
    );
  }
}
