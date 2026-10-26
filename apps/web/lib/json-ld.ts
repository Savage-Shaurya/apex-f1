/**
 * Safe serializer for JSON-LD injected via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` escapes quotes and backslashes but NOT `<`, `>` or `&`.
 * Inside a `<script>` block the HTML parser looks for the literal byte
 * sequence `</script` before the JS parser ever sees the string, so a value
 * containing `</script><img onerror=...>` breaks out of the tag and executes,
 * no matter how well-formed the surrounding JSON is.
 *
 * Apex feeds driver and race names from Jolpica/Ergast and Wikidata into its
 * structured data. That is upstream content we do not control, which makes it
 * untrusted input by definition even though it is not directly user-supplied.
 *
 * Escaping to `\uXXXX` keeps the JSON semantically identical — consumers parse
 * the same string back out — while making it impossible to terminate the tag.
 *
 * NOTE: the last two patterns use `\u2028` / `\u2029` escapes rather than the
 * literal characters. Those code points are line terminators in JS source, so
 * writing them raw inside a regex literal terminates the regex and is a syntax
 * error. They are exactly the characters being defended against.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    // Valid inside JSON, but raw line terminators in JS source — they break
    // the inline script when emitted unescaped.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
