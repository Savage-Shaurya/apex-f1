/**
 * The admin username rule as an HTML `pattern`. Browsers compile `pattern`
 * with the `v` flag, where a bare `-` inside a class is a syntax error that
 * silently switches the client check off, so the hyphen is escaped. It
 * mirrors USERNAME in lib/admin-auth.ts (the server stays authoritative).
 */
export const USERNAME_PATTERN = '[a-z][a-z0-9._\\-]*';
