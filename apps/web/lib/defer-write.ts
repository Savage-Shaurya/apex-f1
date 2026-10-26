import { after } from 'next/server';

/**
 * Run a best-effort cache write after the response with Next's `after()`, so a
 * serverless instance keeps it alive (R3-CODE-8). Outside a request scope
 * (scripts, tests) `after()` is unavailable and the write simply runs now.
 */
export function deferWrite(task: () => Promise<void>): void {
  let scheduled = false;
  try { after(task); scheduled = true; } catch { /* no request scope */ }
  if (!scheduled) void task();
}
