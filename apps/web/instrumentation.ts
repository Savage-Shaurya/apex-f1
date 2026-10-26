import type { Instrumentation } from 'next';

/**
 * Server start: on the Node runtime, validate production configuration and
 * stop with a clear field list instead of serving a half-configured site.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnvironment } = await import('./lib/startup-env');
    assertProductionEnvironment(process.env);
  }
}

/**
 * Every uncaught server error (render, route handler, action, proxy) becomes
 * one structured, redacted log line carrying the digest the visitor sees on
 * the error page, so a report can be matched to its log entry.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { errorSummary, logEvent } = await import('./lib/log');
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest) : undefined;
  logEvent('error', 'request.error', {
    digest,
    method: request.method,
    // Path only: query strings can carry tokens.
    path: request.path.split('?')[0],
    routePath: context.routePath,
    routeType: context.routeType,
    cause: errorSummary(error),
  });
};
