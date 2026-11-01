import { connection } from 'next/server';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { isBuildPhase } from '../../../packages/api-client/src/build-phase';

/**
 * How long a page prerendered during `next build` while a provider was
 * unavailable is served before ISR regenerates it (F-01/F-03): the honest
 * unavailable state lives for one minute after the deploy, never for the
 * route's whole window, and the route stays ISR.
 */
export const BUILD_OUTAGE_REVALIDATE_SECONDS = 60;
/** Same one-minute life for a render that met an outage at runtime (ISR regeneration or first visit). */
export const OUTAGE_REVALIDATE_SECONDS = BUILD_OUTAGE_REVALIDATE_SECONDS;

/**
 * "Do not cache this render": a provider is down and the page shows its
 * honest unavailable state.
 *
 * - Request-time (dynamic) render: `connection()`.
 * - ISR render at runtime (a [param] route with generateStaticParams, or a
 *   static route revalidating): Next cannot switch to dynamic there
 *   (`connection()` throws DYNAMIC_SERVER_USAGE and the visitor would get the
 *   generic error page). The render's revalidate is shortened instead
 *   (OUTAGE_REVALIDATE_SECONDS): the honest partial state is served for one
 *   minute, then the next regeneration reads the provider again. Before this
 *   (audit 2026-11-01 DRV-2, RES-3, TEAMS-10) a degraded render ("Career data
 *   unavailable", no season chart, a missing season) was cached for the
 *   route's whole window (5 min to a day) as if it were a good copy.
 * - `next build`: never `connection()`. A dynamic bailout during the build
 *   turned the whole route into a per-request dynamic route for the life of
 *   the deployment (F-03: team pages had no ISR copy to serve in an outage).
 *   The prerendered honest state instead gets a short revalidate
 *   (BUILD_OUTAGE_REVALIDATE_SECONDS), so the route stays ISR and heals on
 *   the first visit after it.
 */
export async function outageConnection(): Promise<void> {
  const unit = workUnitAsyncStorage.getStore();
  if (isBuildPhase()) {
    shortenBuildRevalidate(unit);
    return;
  }
  if (isRuntimeIsrRender(unit?.type, process.env.NEXT_PHASE)) {
    shortenRevalidate(unit, OUTAGE_REVALIDATE_SECONDS);
    return;
  }
  await connection();
}

export function isRuntimeIsrRender(unitType: string | undefined, phase: string | undefined): boolean {
  return unitType === 'prerender-legacy' && phase !== 'phase-production-build';
}

const warned = new Set<string>();
/** Lowers (never raises) the revalidate Next collects for this prerender; the route segment's own value is a min too. */
function shortenRevalidate(unit: ReturnType<typeof workUnitAsyncStorage.getStore>, seconds: number): boolean {
  if (!unit || !('revalidate' in unit) || typeof unit.revalidate !== 'number') return false;
  if (unit.type !== 'prerender-legacy' && unit.type !== 'prerender' && unit.type !== 'prerender-client') return false;
  (unit as { revalidate: number }).revalidate = Math.min(unit.revalidate, seconds);
  return true;
}

function shortenBuildRevalidate(unit: ReturnType<typeof workUnitAsyncStorage.getStore>): void {
  if (!shortenRevalidate(unit, BUILD_OUTAGE_REVALIDATE_SECONDS)) return;
  const route = workAsyncStorage.getStore()?.route ?? 'a route';
  if (!warned.has(route)) {
    warned.add(route);
    console.warn(`[apex] build: a provider was unavailable while prerendering ${route}; its honest unavailable state is served for ${BUILD_OUTAGE_REVALIDATE_SECONDS} s, then ISR regenerates it.`);
  }
}

/**
 * For a page whose content IS the provider data (it throws a ProviderOutageError
 * or PeopleSourceOutage at runtime, so ISR keeps its last good copy): during
 * `next build` there is no good copy and a throw fails the whole deploy (F-01).
 * Returns true during the build, after shortening the render's revalidate, so
 * the caller renders its honest unavailable state instead of throwing.
 */
export async function outageDuringBuild(): Promise<boolean> {
  if (!isBuildPhase()) return false;
  await outageConnection();
  return true;
}
