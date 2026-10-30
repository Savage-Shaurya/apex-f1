import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, buildReport, logReport } from "./cron-auth";
import { safeErrorMessage } from "./api-input";
import type { syncRecentYouTubeUploads } from "./youtube-sync";
import { providerUnavailableResponse } from "./cron-outcome";

/** Injection keeps scheduler/cache failure behavior testable without Next or DB writes. */
export async function handleYouTubeSync(
  req: Request,
  operations: {
    refresh(): void;
    sync(): ReturnType<typeof syncRecentYouTubeUploads>;
  },
) {
  const start = Date.now();
  if (!isAuthorizedCronRequest(req))
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  if (!process.env.YOUTUBE_API_KEY) {
    const report = buildReport(start, {
      ok: false,
      route: "youtube-sync",
      error: "YOUTUBE_API_KEY missing",
      results: { quotaUnitsAttemptedEstimate: 0 },
    });
    logReport(report);
    return NextResponse.json(report, { status: 503 });
  }
  try {
    operations.refresh();
    const result = await operations.sync();
    if (!result.ok && result.providerUnavailable)
      return providerUnavailableResponse(start, {
        route: "youtube-sync",
        provider: "youtube",
        error: "YouTube is unavailable (timeouts, quota or server errors); stored videos were kept. The next run retries.",
        extra: { channels: result.channels, totals: result.totals },
      });
    const report = {
      ...buildReport(start, {
        ok: result.ok,
        route: "youtube-sync",
        ...(result.errors.length ? { error: result.errors.join("; ") } : {}),
      }),
      channels: result.channels,
      totals: result.totals,
    };
    logReport(report);
    return NextResponse.json(report, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const report = buildReport(start, {
      ok: false,
      route: "youtube-sync",
      error: safeErrorMessage(error),
    });
    logReport(report);
    return NextResponse.json(report, { status: 500 });
  }
}
