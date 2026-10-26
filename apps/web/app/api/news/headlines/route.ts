import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getF1NewsFeed } from "@apex/api-client/rss";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Small cached RSS surface for the live headline ticker; no paid-provider fanout. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("limit") ?? "8";
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 20)
    return NextResponse.json(
      { ok: false, error: "limit must be between 1 and 20" },
      { status: 400 },
    );
  const limit = Number(raw);
  try {
    const feed = await getF1NewsFeed({
      limit: 40,
      revalidate: 300,
      strict: true,
      providers: {
        guardian: false,
        newsapi: false,
        newsdata: false,
        currents: false,
      },
    });
    const seen = new Set<string>();
    const items = [];
    for (const item of feed) {
      let url: URL;
      try {
        url = new URL(item.link);
      } catch {
        continue;
      }
      if (url.protocol !== "https:" || url.username || url.password) continue;
      url.hash = "";
      for (const key of [...url.searchParams.keys()])
        if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      const link = url.href;
      if (seen.has(link)) continue;
      seen.add(link);
      items.push({
        id: createHash("sha256")
          .update(`${item.source}\n${link}`)
          .digest("hex")
          .slice(0, 24),
        title: item.title,
        source: item.source,
        link,
        pubDateMs: item.pubDateMs,
      });
      if (items.length >= limit) break;
    }
    return NextResponse.json(
      { ok: true, items },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Headlines are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
