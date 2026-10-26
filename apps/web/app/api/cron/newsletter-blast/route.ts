import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { jolpica, mapRace, mapDriverStanding, isRankedStanding } from "@apex/api-client/jolpica";
import { getF1NewsFeed } from "@apex/api-client/rss";
import * as ledger from "@apex/db";
import {
  buildReport,
  isAuthorizedCronRequest,
  logReport,
  retry,
  timed,
} from "@/lib/cron-auth";
import { renderRaceWeekBriefing } from "@/lib/email-templates";
import {
  deliverNewsletterEdition,
  NewsletterDeliveryError,
} from "@/lib/newsletter-delivery";
import { isEmail, safeErrorMessage } from "@/lib/api-input";
import { runLeasedCron } from '@/lib/leased-cron';
import { siteOrigin } from '@/components/shell/site-metadata';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Each audience/race edition is guarded by a durable database delivery ledger. */
export async function GET(req: Request) {
  const start = Date.now();
  if (!isAuthorizedCronRequest(req))
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const finish = (partial: Parameters<typeof buildReport>[1], status = 200) => {
    const report = buildReport(start, {
      route: "newsletter-blast",
      ...partial,
    });
    logReport(report);
    return NextResponse.json(report, { status });
  };
  for (const key of [
    "RESEND_API_KEY",
    "RESEND_AUDIENCE_ID",
    "RESEND_FROM_EMAIL",
    "DATABASE_URL",
  ] as const) {
    if (!process.env[key])
      return finish(
        { ok: false, error: `${key} missing; newsletter not sent.` },
        503,
      );
  }
  const apiKey = process.env.RESEND_API_KEY!;
  const audienceId = process.env.RESEND_AUDIENCE_ID!;
  const fromEmail = process.env.RESEND_FROM_EMAIL!;
  if (!isEmail(fromEmail) || fromEmail.toLowerCase().endsWith("@resend.dev")) {
    return finish(
      {
        ok: false,
        error:
          "RESEND_FROM_EMAIL must be an address on a verified custom domain.",
      },
      503,
    );
  }
  const fromName = (process.env.RESEND_FROM_NAME ?? "Apex · Race Week")
    .replace(/[<>\r\n]/g, "")
    .slice(0, 80);
  const siteUrl = siteOrigin();
  return runLeasedCron(req, 'newsletter-blast', async (job) => {
  const timings: Record<string, number> = {};
  try {
    const [schedule, scheduleMs] = await timed(() =>
      retry(
        () => jolpica.getSchedule("current", { revalidate: 600, strict: true, signal: job.signal, deadlineMs: 10_000 }),
        { attempts: 2, deadlineMs: 15_000 },
      ),
    );
    timings.scheduleMs = scheduleMs;
    if (!schedule.length)
      throw new Error(
        "schedule returned no races; cannot distinguish off-season from incomplete data",
      );
    const now = Date.now();
    const nextRace = schedule
      .map(mapRace)
      .filter((race) => {
        const time = Date.parse(race.raceStartIso);
        return time > now && time - now < 8 * 86_400_000;
      })
      .sort(
        (a, b) => Date.parse(a.raceStartIso) - Date.parse(b.raceStartIso),
      )[0];
    if (!nextRace)
      return finish({
        ok: true,
        skipped: "No race in the next 8 days.",
        results: { timings },
      });
    const [[items, rssMs], [standings, standingsMs]] = await Promise.all([
      timed(() => getF1NewsFeed({ limit: 12, revalidate: 300, strict: true, signal: job.signal, timeoutMs: 10_000 })),
      timed(() =>
        jolpica.getDriverStandingsSnapshot("current", {
          revalidate: 600,
          strict: true,
          signal: job.signal,
          deadlineMs: 10_000,
        }),
      ),
    ]);
    timings.rssMs = rssMs;
    timings.standingsMs = standingsMs;
    if (!items.length)
      throw new Error(
        "newsletter news feed returned no stories; briefing not sent",
      );
    const articles = items
      .slice(0, 8)
      .map((item) => ({
        title: item.title,
        source: item.source,
        link: item.link,
        description: item.description ?? undefined,
        pubDateMs: item.pubDateMs,
      }));
    const standingsSeason = standings.season ? Number(standings.season) : null;
    const driverStandings = standings.standings
      .map(mapDriverStanding)
      .filter(isRankedStanding)
      .slice(0, 5)
      .map((row) => ({
        position: row.position,
        driverName: row.driver.fullName,
        teamName: row.constructorName || "Independent",
        points: row.points,
      }));
    const email = renderRaceWeekBriefing({
      next: nextRace,
      articles,
      driverStandings,
      standingsSeason,
      siteUrl,
      issuedAtMs: now,
    });
    // Version is a delivery edition definition, not a template/design revision.
    const key = `race-week-v1:${nextRace.season}:${nextRace.slug}:${createHash("sha256").update(audienceId).digest("hex").slice(0, 24)}`;
    job.assertActive();
    if (job.remainingMs() < 22_000) throw new Error('Newsletter delivery deferred before starting a broadcast; insufficient remaining job budget.');
    const [delivery, deliveryMs] = await timed(() =>
      deliverNewsletterEdition(
        { key, apiKey, audienceId, fromEmail, fromName, email, signal: job.signal },
        ledger,
      ),
    );
    timings.deliveryMs = deliveryMs;
    return finish({
      ok: true,
      ...(delivery.status === "already-sent"
        ? { skipped: "This audience/race edition was already sent." }
        : {}),
      results: {
        deliveryStatus: delivery.status,
        broadcastId: delivery.broadcastId,
        nextRace: nextRace.name,
        articleCount: articles.length,
        standingsCount: driverStandings.length,
        timings,
      },
    });
  } catch (err) {
    return finish(
      {
        ok: false,
        error: safeErrorMessage(err),
        results: {
          timings,
          ...(err instanceof NewsletterDeliveryError
            ? { uncertain: err.uncertain }
            : {}),
        },
      },
      err instanceof NewsletterDeliveryError ? err.status : 500,
    );
  }
  });
}
