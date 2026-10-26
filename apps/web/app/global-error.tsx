'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary: only renders when the root layout itself fails, so it
 * owns <html>/<body> and cannot rely on globals.css, fonts or the shell.
 * Carbon field, white type, one red rule; plain words, a retry and a link home.
 * The visitor sees a reference (the digest) that matches the server log line
 * written by instrumentation.onRequestError, never the raw error.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Browser console only; the server already logged the full, redacted record.
    console.error('[apex] application error', error.digest ?? error.name);
  }, [error]);

  const digest = error.digest && /^[A-Za-z0-9_-]{1,64}$/.test(error.digest) ? error.digest : null;

  return (
    <html lang="en-GB">
      <head>
        <title>Apex · Something went wrong</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          :root { color-scheme: dark; }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100svh; background: #0b0b0c; color: #f5f5f4;
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
            display: grid; place-items: center; padding: 24px 16px; letter-spacing: 0.005em; }
          main { width: 100%; max-width: 44rem; }
          .rule { width: 56px; height: 4px; background: #e10600; margin-bottom: 28px; }
          .label { font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #ff4d45; margin: 0; }
          h1 { font-size: clamp(2.25rem, 8vw, 4.5rem); line-height: 1.02; font-weight: 800; margin: 16px 0 0; letter-spacing: -0.01em; }
          p.body { font-size: clamp(1.0625rem, 1rem + 0.4vw, 1.25rem); line-height: 1.5; color: #c9c9c6; max-width: 42ch; margin: 24px 0 0; }
          .ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875rem; color: #9a9a96; margin: 16px 0 0; overflow-wrap: anywhere; }
          .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 36px; }
          .btn { min-height: 52px; padding: 0 24px; font: inherit; font-size: 1.0625rem; font-weight: 650; display: inline-flex; align-items: center; text-decoration: none; cursor: pointer; border: 1px solid #f5f5f4; }
          .primary { background: #f5f5f4; color: #0b0b0c; }
          .secondary { background: transparent; color: #f5f5f4; }
          .btn:focus-visible { outline: 3px solid #ff4d45; outline-offset: 3px; }
          @media (hover: hover) { .primary:hover { background: #d6d6d3; } .secondary:hover { border-color: #ff4d45; } }
        `}</style>
      </head>
      <body>
        <main aria-labelledby="global-error-title">
          <div className="rule" aria-hidden="true" />
          <p className="label">Something went wrong</p>
          <h1 id="global-error-title">Red flag. The session is stopped.</h1>
          <p className="body">
            Apex hit a problem it could not recover from on this page. Nothing you did caused it. Trying again usually
            brings the page back; if it does not, please come back in a few minutes.
          </p>
          {digest ? <p className="ref">Reference: {digest}</p> : null}
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => retry()}>Try again</button>
            {/* A full page load, not client navigation: the app shell itself failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="btn secondary" href="/">Back to the home page</a>
          </div>
        </main>
      </body>
    </html>
  );
}
