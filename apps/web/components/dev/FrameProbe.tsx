'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { FrameSamplingWindow } from './frame-statistics.mjs';

/**
 * Developer measurement only. Root layout mounts this exclusively when
 * NEXT_PUBLIC_PERFORMANCE_PROBE === '1' at build time; default off means no
 * sampling, observer, timer, DOM node, or product UI. No telemetry/network.
 *
 * Read output[data-testid="performance-probe"] via browser DOM inspection:
 * JSON text plus data-count/window-duration-ms/average-interval-ms/p95-interval-ms/
 * max-interval-ms/frames-over-25-ms/long-task-count. Count = intervals, not GPU
 * frames. p95 uses nearest rank. Durations are milliseconds, null means no data.
 * Rolling last 5 seconds plus its preceding boundary timestamp, excluding first
 * 1 second after pathname/visibility change. A visible stall spanning the cutoff
 * stays measured (actual window duration can exceed 5s). Hidden-tab pauses cannot
 * become fake slow frames. Measurement still
 * runs under reduced motion; this does not change source animation preferences.
 *
 * Overhead: one RAF callback storing a timestamp (no per-frame React update),
 * 18 KiB bounded numeric storage, optional Long Tasks observer, and one small
 * sort/JSON/hidden DOM write per second. Overhead is real and not benchmarked.
 * These are browser RAF scheduling intervals, not GPU/render time, presentation
 * latency, dropped-frame attribution, device refresh detection or a 120 FPS
 * guarantee. Compare recorded production route/viewport/workload; dev tools,
 * power policy, throttling and remote browser display can affect results.
 *
 * API semantics/support:
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
 * https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/supportedEntryTypes_static
 */
export function FrameProbe() {
  const pathname = usePathname();
  const output = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PERFORMANCE_PROBE !== '1') return;
    const sampler = new FrameSamplingWindow();
    let frame: number | null = null;
    let disposed = false;
    let observer: PerformanceObserver | null = null;
    let longTasksSupported = false;

    function sample(timestamp: number) {
      if (disposed || document.hidden) return;
      sampler.recordFrame(timestamp);
      frame = requestAnimationFrame(sample);
    }

    function resetVisibility() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      sampler.reset(performance.now());
      if (!document.hidden && !disposed) frame = requestAnimationFrame(sample);
    }

    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      try {
        observer = new PerformanceObserver((list) => {
          if (disposed || document.hidden) return;
          for (const entry of list.getEntries()) sampler.recordLongTask(entry.startTime, entry.duration);
        });
        // No historic entries: route changes and warmup are intentional resets.
        observer.observe({ type: 'longtask', buffered: false });
        longTasksSupported = true;
      } catch {
        observer?.disconnect();
        observer = null;
      }
    }

    resetVisibility();
    document.addEventListener('visibilitychange', resetVisibility);
    const publisher = window.setInterval(() => {
      const node = output.current;
      if (!node || disposed) return;
      const stats = sampler.snapshot(performance.now(), longTasksSupported);
      const status = document.hidden ? 'paused' : stats.status;
      const published = {
        ...stats, status, pathname,
        measurement: 'requestAnimationFrame scheduling intervals',
        publishedAtMs: performance.now(),
      };
      node.textContent = JSON.stringify(published);
      node.dataset.status = status;
      node.dataset.pathname = pathname ?? '';
      node.dataset.count = String(stats.count);
      node.dataset.windowDurationMs = String(stats.windowDurationMs);
      node.dataset.averageIntervalMs = String(stats.averageIntervalMs);
      node.dataset.p95IntervalMs = String(stats.p95IntervalMs);
      node.dataset.maxIntervalMs = String(stats.maxIntervalMs);
      node.dataset.framesOver25Ms = String(stats.framesOver25Ms);
      node.dataset.longTaskCount = String(stats.longTaskCount);
      node.dataset.longTasksSupported = String(stats.longTasksSupported);
    }, 1000);

    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.clearInterval(publisher);
      document.removeEventListener('visibilitychange', resetVisibility);
      observer?.disconnect();
    };
  }, [pathname]);

  if (process.env.NEXT_PUBLIC_PERFORMANCE_PROBE !== '1') return null;
  return <output ref={output} hidden aria-hidden="true" data-testid="performance-probe" data-status="warming">{'{"status":"warming"}'}</output>;
}
