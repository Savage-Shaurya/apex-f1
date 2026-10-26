# Development dependency mitigation

The full registry audit reports GHSA-vfj7-8cjw-p6xm in braces 3.0.3. As checked on 4 October 2026, the advisory lists no upstream patched release. This workspace reaches braces only through the Next.js ESLint development dependency. The production dependency audit is separately required to contain no advisories.

`braces@3.0.3.patch` limits parser AST nesting to 64 across both brace and parenthesis blocks. Quotes, escaped characters and bracket literals retain their normal behavior. The installed dependency chain is tested by `scripts/braces-security.test.mjs`; testing a copied package alone would not establish that the workspace uses the mitigation.

This is a local mitigation, not an upstream fixed version. Callers that manually construct an AST can bypass the string parser limit. The application does not expose this development dependency as a request-processing feature.

`pnpm run audit:checked` preserves the full and production registry reports. Its development exception accepts only the exact advisory, version, lint dependency path, checked-in patch SHA-256 and passing installed-package regression. It expires on 18 October 2026. Unknown advisories, production advisories, missing evidence or an expired review fail the check. Recheck the upstream advisory and dependency graph before renewing or removing this exception; do not extend it automatically.

CI and the scheduled dependency workflow use this same check. Their execution on the hosting repository remains separate from the local validation.
