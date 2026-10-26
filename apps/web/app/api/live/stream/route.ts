import { getOpenF1AccessConfig, openf1 } from '@apex/api-client/openf1';
import type { LiveFrame } from '@/lib/live-session-hub';
import { createConfiguredLiveSessionHub } from '@/lib/live-distributed-hub';
import { tooMany } from '@/lib/rate-limit';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEW_CONNECTION_LIMIT = 12;
const MAX_CONCURRENT_STREAMS = 64;
const STREAM_LIFETIME_MS = 55_000;
const MAX_FRAME_BYTES = 32_768;
const encoder = new TextEncoder();

// All instances share one fenced ingest owner, global live-ingestion quota and
// bounded Redis snapshot. Undeployed development explicitly reports local scope.
const liveProcess = globalThis as typeof globalThis & {
  __apexLiveSessionHubV3?: NonNullable<ReturnType<typeof createConfiguredLiveSessionHub>>;
  __apexOpenLiveStreamsV2?: number;
};

export async function GET(request: Request) {
  const limit = await rateLimitShared(request, { limit: NEW_CONNECTION_LIMIT, windowMs: 60_000, bucket: 'live-stream-open' });
  if (!limit.available) return rateLimitUnavailable(limit);
  if (!limit.ok) return tooMany(limit);
  const hub = liveProcess.__apexLiveSessionHubV3 ??= createConfiguredLiveSessionHub({ source: openf1, access: getOpenF1AccessConfig }) ?? undefined;
  if (!hub) return Response.json({ ok: false, error: 'Shared live updates are unavailable.' }, {
    status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' },
  });
  if ((liveProcess.__apexOpenLiveStreamsV2 ?? 0) >= MAX_CONCURRENT_STREAMS) {
    return Response.json({ ok: false, error: 'Stream capacity reached; retry shortly.' }, {
      status: 503, headers: { 'Retry-After': '30' },
    });
  }

  let closeStream = () => {};
  let flushPending = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (request.signal.aborted) { controller.close(); return; }
      liveProcess.__apexOpenLiveStreamsV2 = (liveProcess.__apexOpenLiveStreamsV2 ?? 0) + 1;
      let closed = false;
      let unsubscribe = () => {};
      let expiry: ReturnType<typeof setTimeout> | null = null;
      // One most-recent frame per channel, instead of an unbounded viewer queue.
      const pending = new Map<string, Uint8Array>();
      const close = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', close);
        if (expiry !== null) clearTimeout(expiry);
        pending.clear();
        unsubscribe();
        liveProcess.__apexOpenLiveStreamsV2 = Math.max(0, (liveProcess.__apexOpenLiveStreamsV2 ?? 1) - 1);
        try { controller.close(); } catch { /* Stream was already canceled. */ }
      };
      closeStream = close;
      const flush = () => {
        if (closed) return;
        try {
          while ((controller.desiredSize ?? 0) > 0 && pending.size) {
            const next = pending.entries().next().value;
            if (!next) break;
            pending.delete(next[0]);
            controller.enqueue(next[1]);
          }
        } catch { close(); }
      };
      flushPending = flush;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          const bytes = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (bytes.byteLength > MAX_FRAME_BYTES) { close(); return; }
          pending.set(event, bytes);
          flush();
        } catch { close(); }
      };
      request.signal.addEventListener('abort', close, { once: true });
      emit('connected', { ts: Date.now(), source: 'openf1', scope: hub.scope });
      unsubscribe = hub.subscribe((frame: LiveFrame) => emit(frame.event, frame.data));
      if (closed) unsubscribe();
      else expiry = setTimeout(close, STREAM_LIFETIME_MS);
      if (request.signal.aborted) close();
    },
    pull() { flushPending(); },
    cancel() { closeStream(); },
  });

  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  } });
}
