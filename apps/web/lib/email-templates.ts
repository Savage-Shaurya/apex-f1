/**
 * Apex email templates.
 *
 * Plain-string HTML so the cron route stays one file and we never pull in a
 * full email-renderer dependency. Each template returns a `{ subject, html,
 * text }` triple ready to hand to Resend's Broadcasts API.
 *
 * Apex brand inside the inbox:
 *   - Carbon black backdrop (#0f0f0f)
 *   - Telemetry-red accent (#e10600)
 *   - JetBrains Mono for data, system serif for editorial
 *   - 600px column, mobile-safe, no images required (RSS images may not be
 *     deliverable from email clients; we link out to the headline instead)
 */

export interface BriefingArticle {
  title: string;
  source: string;
  link: string;
  description?: string;
  pubDateMs: number;
}

export interface BriefingNextRace {
  name: string;
  country: string;
  raceStartIso: string;
  slug: string;
  routeSlug?: string;
  season: number;
}

export interface BriefingStanding {
  position: number;
  driverName: string;
  teamName: string;
  points: number;
}

export interface RaceWeekBriefingInput {
  next: BriefingNextRace | null;
  articles: BriefingArticle[];
  driverStandings: BriefingStanding[];
  siteUrl: string;
  /** Season the standings table belongs to. Without it the link goes to the results archive, never a guessed year. */
  standingsSeason?: number | null;
  /** When the edition is issued: the copyright year comes from it (one clock, R3-CODE-9). */
  issuedAtMs: number;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderRaceWeekBriefing(
  input: RaceWeekBriefingInput,
): EmailTemplate {
  const { next, driverStandings } = input;
  // An explicit null means Jolpica could not say which season the table is: no guess from the next race.
  const standingsSeason = input.standingsSeason !== undefined ? input.standingsSeason : next?.season ?? null;
  const standingsPath = standingsSeason !== null && Number.isSafeInteger(standingsSeason) ? `/results/${standingsSeason}/drivers` : "/results/archive";
  const copyrightYear = new Date(input.issuedAtMs).getUTCFullYear();
  const site = new URL(input.siteUrl);
  if (site.protocol !== "https:" || site.username || site.password)
    throw new Error("Newsletter site URL must use HTTPS without credentials.");
  const siteUrl = site.origin;
  const articles = input.articles
    .filter((article) => {
      try {
        const url = new URL(article.link);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    })
    .slice(0, 8);
  const subjectRace = next ? next.name : "Race Week Briefing";
  const subject = `Race Week · ${subjectRace} · the briefing before lights out`;

  const articleRows = articles
    .slice(0, 8)
    .map(
      (a) => `
        <tr>
          <td style="padding:18px 0;border-bottom:1px solid #2a2a2a;">
            <div style="font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.22em;color:#e10600;text-transform:uppercase;margin-bottom:8px;">
              ${escape(a.source)}
            </div>
            <a href="${escape(a.link)}" style="color:#e5e2e1;text-decoration:none;font:700 18px/1.3 Georgia,'Times New Roman',serif;">
              ${escape(a.title)}
            </a>
            ${a.description ? `<p style="margin:8px 0 0;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;color:#a8a8a8;">${escape(a.description.slice(0, 220))}${a.description.length > 220 ? "&hellip;" : ""}</p>` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const standingsRows = driverStandings
    .slice(0, 5)
    .map(
      (s) => `
        <tr>
          <td style="padding:10px 6px;border-bottom:1px solid #1f1f1f;font:500 13px/1 'JetBrains Mono','Menlo',monospace;color:#e5e2e1;width:36px;">${s.position}</td>
          <td style="padding:10px 6px;border-bottom:1px solid #1f1f1f;font:400 14px/1.3 Georgia,'Times New Roman',serif;color:#e5e2e1;">${escape(s.driverName)}</td>
          <td style="padding:10px 6px;border-bottom:1px solid #1f1f1f;font:400 12px/1 'JetBrains Mono','Menlo',monospace;color:#888;">${escape(s.teamName)}</td>
          <td style="padding:10px 6px;border-bottom:1px solid #1f1f1f;font:500 13px/1 'JetBrains Mono','Menlo',monospace;color:#e10600;text-align:right;">${s.points}</td>
        </tr>`,
    )
    .join("");

  const nextRaceBlock = next
    ? `
      <tr>
        <td style="padding:28px 0 6px;">
          <div style="font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.24em;color:#e10600;text-transform:uppercase;">
            Next Race
          </div>
          <h2 style="margin:10px 0 4px;font:800 32px/1.05 Georgia,'Times New Roman',serif;color:#e5e2e1;letter-spacing:-0.02em;">
            ${escape(next.name)}
          </h2>
          <div style="font:500 13px/1 'JetBrains Mono','Menlo',monospace;color:#a8a8a8;letter-spacing:.08em;">
            ${escape(next.country.toUpperCase())} &middot; ${escape(fmtDate(next.raceStartIso))} UTC
          </div>
          <a href="${escape(siteUrl)}/schedule/${next.season}/${encodeURIComponent(next.routeSlug ?? next.slug)}"
             style="display:inline-block;margin-top:18px;padding:12px 20px;background:#e10600;color:#fff;font:600 12px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;">
            Full session schedule &rarr;
          </a>
        </td>
      </tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escape(subject)}</title>
  </head>
  <body style="margin:0;background:#0f0f0f;color:#e5e2e1;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#0f0f0f;">
      ${next ? `Race Week ${escape(next.name)} preview &middot; standings &middot; ${articles.length} stories &middot; from Apex` : "Race Week preview · top stories · standings · from Apex"}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f0f0f;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0f0f0f;">
            <tr>
              <td style="padding-bottom:24px;border-bottom:1px solid #2a2a2a;">
                <a href="${escape(siteUrl)}" style="font:800 28px/1 Georgia,'Times New Roman',serif;color:#e5e2e1;text-decoration:none;letter-spacing:-0.03em;">APEX</a>
                <span style="margin-left:10px;font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.22em;color:#e10600;text-transform:uppercase;">Race Week Briefing</span>
              </td>
            </tr>
            ${nextRaceBlock}
            <tr>
              <td style="padding:36px 0 14px;border-bottom:1px solid #2a2a2a;">
                <div style="font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.24em;color:#e10600;text-transform:uppercase;">
                  Top of the Wire
                </div>
                <p style="margin:8px 0 0;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;color:#a8a8a8;">
                  ${articles.length} ${articles.length === 1 ? "story" : "stories"} from the wire. Headlines link to source · we don't republish.
                </p>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${articleRows || '<tr><td style="padding:18px 0;color:#888;">Newsroom feed quiet · we will catch up next race week.</td></tr>'}
                </table>
              </td>
            </tr>
            ${
              driverStandings.length > 0
                ? `
            <tr>
              <td style="padding-top:36px;border-bottom:1px solid #2a2a2a;padding-bottom:14px;">
                <div style="font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.24em;color:#e10600;text-transform:uppercase;">
                  Drivers Top 5
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${standingsRows}
                </table>
                <a href="${escape(siteUrl)}${standingsPath}" style="display:inline-block;margin-top:16px;font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.22em;color:#e5e2e1;text-decoration:none;text-transform:uppercase;border-bottom:1px solid #e10600;padding-bottom:2px;">
                  Full standings &rarr;
                </a>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:48px 0 24px;border-top:1px solid #2a2a2a;margin-top:36px;">
                <p style="margin:0;font:400 12px/1.55 Georgia,'Times New Roman',serif;color:#888;">
                  Apex is an independent fan-built platform · zero ads, zero affiliate widgets, zero
                  team sponsorships. Designed, engineered, shipped by one person.
                </p>
                <p style="margin:14px 0 0;font:400 11px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#666;">
                  You received this briefing because you subscribed to Apex.
                  <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#a8a8a8;">Unsubscribe from future briefings</a>.
                </p>
                <p style="margin:18px 0 0;font:600 11px/1 'JetBrains Mono','Menlo',monospace;letter-spacing:.22em;color:#666;">
                  &copy; ${copyrightYear} APEX &middot; INDEPENDENT &middot; SOLO BUILD
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "APEX · Race Week Briefing",
    "",
    next
      ? `Next race: ${next.name} (${next.country}) · ${fmtDate(next.raceStartIso)} UTC`
      : "",
    next
      ? `${siteUrl}/schedule/${next.season}/${encodeURIComponent(next.routeSlug ?? next.slug)}`
      : "",
    "",
    "- Top of the wire -",
    ...articles
      .slice(0, 8)
      .map((a) => `· [${a.source}] ${a.title}\n  ${a.link}`),
    "",
    driverStandings.length > 0 ? "- Drivers top 5 -" : "",
    ...driverStandings
      .slice(0, 5)
      .map(
        (s) =>
          `${s.position}. ${s.driverName} (${s.teamName}) · ${s.points} pts`,
      ),
    "",
    "Apex is independent and fan-built · no ads, no sponsorships.",
    `Read more: ${siteUrl}`,
    "Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}",
  ].join("\n");

  return { subject, html, text };
}
