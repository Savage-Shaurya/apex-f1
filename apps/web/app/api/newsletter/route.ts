import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import {
  rateLimitShared,
  rateLimitUnavailable,
} from "@/lib/distributed-rate-limit";
import { validateJsonMutationRequest } from "@/lib/mutation-guard";
import { fetchProviderJson } from "@/lib/provider-json";
import {
  readJsonObject,
  stringField,
  isEmail,
  InputError,
  errorResponse,
} from "@/lib/api-input";

export const runtime = "nodejs";
export const maxDuration = 30;
const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { ...init, headers });
};

/** A success response means a confirmed provider contact; there is no local queue. */
export async function POST(req: Request) {
  const guard = validateJsonMutationRequest(req);
  if (guard) return guard;
  const rl = rateLimit(req, {
    limit: 30,
    windowMs: 60_000,
    bucket: "newsletter-parse",
  });
  if (!rl.ok) return tooMany(rl);
  let email: string;
  try {
    email = stringField(
      await readJsonObject(req, 2_048),
      "email",
      254,
      true,
    ).toLowerCase();
    if (!isEmail(email)) throw new InputError("invalid email");
  } catch (err) {
    return errorResponse(err);
  }
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return json(
      {
        ok: false,
        error:
          "Newsletter signup is temporarily unavailable. Please try again later.",
      },
      { status: 503 },
    );
  }
  const shared = await rateLimitShared(req, {
    limit: 5,
    windowMs: 60_000,
    bucket: "newsletter",
    localFallback: true,
  });
  if (!shared.available) return rateLimitUnavailable(shared);
  if (!shared.ok) return tooMany(shared);
  const contactsUrl = `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  try {
    const response = await fetchProviderJson(contactsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, unsubscribed: false }),
    }, { timeoutMs: 8_000 });
    if (response.status === 409) {
      // An existing record can be unsubscribed; a conflict alone is not evidence of subscription.
      const existing = await fetchProviderJson(
        `${contactsUrl}/${encodeURIComponent(email)}`,
        { headers }, { timeoutMs: 5_000 },
      );
      if (!existing.ok)
        return json(
          {
            ok: false,
            error:
              "Your existing subscription could not be confirmed. Please try again later.",
          },
          { status: 502 },
        );
      const contact: unknown = existing.value;
      if (
        !contact ||
        typeof contact !== "object" ||
        !("unsubscribed" in contact) ||
        contact.unsubscribed !== false
      ) {
        return json(
          {
            ok: false,
            duplicate: true,
            error:
              "This address already has a contact record, but an active subscription could not be confirmed.",
          },
          { status: 409 },
        );
      }
      return json({
        ok: true,
        mode: "resend",
        duplicate: true,
        welcomeStatus: "not-requested",
      });
    }
    if (!response.ok)
      return json(
        {
          ok: false,
          error:
            "Newsletter provider could not save your subscription. Please try again later.",
        },
        { status: 502 },
      );
    const contact: unknown = response.value;
    if (
      !contact ||
      typeof contact !== "object" ||
      !("id" in contact) ||
      typeof contact.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(contact.id)
    ) {
      return json(
        {
          ok: false,
          error:
            "Newsletter provider returned an invalid confirmation. Please try again later.",
        },
        { status: 502 },
      );
    }
    const welcomeStatus = await sendWelcomeEmail(email, apiKey);
    return json({
      ok: true,
      mode: "resend",
      id: contact.id,
      welcomeStatus,
    });
  } catch {
    return json(
      {
        ok: false,
        error:
          "Newsletter provider is temporarily unreachable. Please try again later.",
      },
      { status: 503 },
    );
  }
}

async function sendWelcomeEmail(
  email: string,
  apiKey: string,
): Promise<"sent" | "unavailable" | "failed"> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from || !isEmail(from) || from.toLowerCase().endsWith("@resend.dev"))
    return "unavailable";
  const configuredName = process.env.RESEND_FROM_NAME ?? "Apex";
  const fromName = configuredName.replace(/[<>\r\n]/g, "").slice(0, 80);
  try {
    const response = await fetchProviderJson("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `apex-welcome-v1-${createHash("sha256").update(email).digest("hex")}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${from}>`,
        to: [email],
        subject: "You're on the Apex pit wall",
        html: WELCOME_HTML,
        text: "Welcome to Apex. Your subscription has been saved. Race week briefings include the upcoming race, news headlines and standings. Every briefing includes a link to unsubscribe.",
      }),
    }, { timeoutMs: 5_000 });
    if (!response.ok) return "failed";
    const confirmation: unknown = response.value;
    return confirmation &&
      typeof confirmation === "object" &&
      "id" in confirmation &&
      typeof confirmation.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(confirmation.id)
      ? "sent"
      : "failed";
  } catch {
    return "failed";
  }
}

const WELCOME_HTML = `<div style="background:#0f0f0f;color:#e9e9e9;font-family:Helvetica,Arial,sans-serif;padding:40px 24px;"><div style="max-width:560px;margin:0 auto;"><div style="color:#e10600;font-size:12px;letter-spacing:3px;font-weight:700;">APEX · RACE WEEK BRIEFING</div><h1 style="font-size:30px;line-height:1.1;margin:18px 0 0;color:#fff;">You're on the pit wall.</h1><p style="font-size:16px;line-height:1.6;color:#b8b8b8;">Your subscription has been saved. Race week briefings bring you the upcoming race, news headlines and standings.</p><p style="font-size:13px;color:#777;margin-top:28px;">Every briefing includes a link to unsubscribe.</p></div></div>`;

export function GET() {
  return json(
    { ok: false, error: "POST only" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
