# Administrator authentication

Production administrators sign in at `/admin/login` with their named password and a six-digit authenticator code. Password-only Basic authentication and the legacy `ADMIN_PASSWORD` owner are disabled in production and every deployed environment. Every privileged handler independently verifies the session and its explicit capability; the Proxy is an additional gate.

## Private provisioning

Keep the existing `ADMIN_USERS_JSON` profile shape: an array of `{username,passwordHash,capabilities}`. Generate each password hash with `scripts/admin-password-hash.mjs`, providing the password through a private stdin pipe. Never put passwords in command-line arguments, source, CI logs or tickets. Capabilities remain `read`, `write`, `publish`, `image` and the separately granted `newsletter-reconcile`.

The deployment also requires:

| Field | Required private value |
|---|---|
| `ADMIN_SESSION_SECRET` | At least 32 cryptographically random bytes encoded as canonical unpadded base64url; 43 characters for 32 bytes. |
| `ADMIN_MFA_SECRETS_JSON` | JSON object mapping every configured username to a different random 20-byte secret encoded as exactly 32 uppercase unpadded Base32 characters. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | The shared authoritative Redis connection. |
| `DISTRIBUTED_RATE_LIMIT_REQUIRED` | `true`. |

`scripts/admin-mfa-provision.mjs` reads the named profile array from stdin and writes these authentication fields to a **new absolute file outside the repository** ending in `.private.json`. It refuses overwrite and prints no secret material. The file is owner-only on Unix. On Windows, first use a private output folder owned by the current account, with protected inheritance and Allow permissions restricted to that account and SYSTEM; the CLI verifies this before creating the file, then also removes file inheritance before writing. This prevents a reader obtaining a file handle while an initially public file is empty. Supply its private values through your hosting provider's secret manager; do not add this file to the release artifact.

For each operator, privately enroll the generated second-factor secret in an authenticator using TOTP, SHA-1, six digits and 30-second intervals. Use a trusted private channel and verify enrollment before retiring previous access. The app does not expose factor secrets, online factor enrollment, recovery codes or a password-only recovery bypass. A narrowly scoped operator without `read` uses their authorized API rather than receiving editorial access automatically.

## Session behavior

The deployment uses a `__Host-apex_admin` cookie with Secure, HttpOnly, SameSite=Strict and Path=/. Only an opaque random token is in the cookie; Redis keys contain its keyed hash. There is one active session per actor. A fresh successful login revokes the previous session, including one used on another instance or device.

Sessions expire after 30 minutes regardless of use and after 15 minutes of inactivity. Redis time owns both deadlines. Ordinary Redis `EVAL` reads go to the authoritative primary, so an expired or logged-out session cannot remain accepted by a replica or in-process authentication cache. OTP validation and consumption, session creation and prior-session replacement commit atomically. A code is accepted only within one 30-second step on either side of the current clock and only once; logout never resets this consumed counter.

Login is limited to 20 attempts per network bucket per five minutes and five attempts per configured actor per five minutes across all network buckets. Unconfigured names share one bounded account bucket. Password verification has a separate maximum of eight simultaneous derivations. Missing or failed shared storage returns an unavailable response without granting access or issuing a cookie.

Login, logout and cookie-authenticated unsafe methods require an explicit Origin matching the request target. Contradictory browser fetch metadata is rejected. The originless CLI exception for development Basic credentials never applies to sessions. Cookie ambiguity or tampering never falls back to Basic.

Sign out revokes the server session before expiring the cookie. If revocation cannot be confirmed, the UI keeps the cookie and offers retry. Password, capability or second-factor changes invalidate an existing session through the current actor fingerprint; rotating `ADMIN_SESSION_SECRET` invalidates all sessions. Configuration changes must be applied to **every running instance**: an old process with old configuration must be drained before global revocation is considered complete.

## Recovery and release checks

If an operator loses their authenticator, an authorized infrastructure operator provisions a new unique factor through the private control plane and restarts/drains every instance with the changed configuration. This changes the actor fingerprint and revokes their prior sessions. Do not temporarily restore production Basic access, remove MFA or expose secrets in a support ticket. Keep secret-manager access and factor distribution restricted to authorized operators.

Production security preflight rejects missing session/MFA fields, duplicate factors, unsupported profiles, legacy owner credentials and missing shared Redis. An actual TLS/browser login, cross-instance revocation/logout and provider compatibility check belong to deployment acceptance. Disposable local fixtures prove local behavior and are not real identity-provider acceptance.

Undeployed `development` and `test` processes retain configured Basic compatibility for existing tools. That compatibility does not provide the production session lifecycle. Deployments cannot enable it by selecting development mode or adding a local bypass flag.

The TOTP behavior follows [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238). Session cookie and expiry decisions follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); authoritative hosted Redis reads use ordinary [Upstash EVAL](https://upstash.com/blog/replicated-cache-backed-by-redis).
