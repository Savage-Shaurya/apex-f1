/**
 * Thrown by the People [slug] layouts when Jolpica F1 cannot confirm whether a
 * driver or constructor exists. It runs above every loading boundary, so the
 * response is a 5xx (an outage must never ship as a 200 "unavailable" page
 * that search engines index or drop, SEO-2), and an ISR page that fails to
 * regenerate keeps serving its last good render. The area error boundary
 * (app/drivers/error.tsx, app/teams/error.tsx) shows the truthful state.
 */
export class PeopleSourceOutage extends Error {
  constructor(what: string) {
    super(`${what} could not be confirmed with Jolpica F1`);
    this.name = 'PeopleSourceOutage';
  }
}
