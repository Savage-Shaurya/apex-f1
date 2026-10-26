export type ArticleInlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string; index: number }
  | { kind: 'strong' | 'em' | 'code'; text: string; index: number };

/** The existing Markdown subset, with linear work even on incomplete delimiters. */
export function tokenizeArticleInline(text: string): ArticleInlineToken[] {
  const delimiters = [']', ')', '*', '_', '`', 'space'] as const;
  const next = Object.fromEntries(delimiters.map((key) => [key, new Int32Array(text.length + 1)])) as Record<typeof delimiters[number], Int32Array>;
  const positions = Object.fromEntries(delimiters.map((key) => [key, -1])) as Record<typeof delimiters[number], number>;
  for (let index = text.length; index >= 0; index--) {
    for (const key of delimiters) next[key][index] = positions[key];
    const character = text[index];
    if (character === ']' || character === ')' || character === '*' || character === '_' || character === '`') positions[character] = index;
    if (character !== undefined && /\s/.test(character)) positions.space = index;
  }
  const tokens: ArticleInlineToken[] = [];
  let cursor = 0;
  for (let index = 0; index < text.length;) {
    const character = text[index];
    let token: Exclude<ArticleInlineToken, { kind: 'text' }> | null = null;
    let end = index;
    if (character === '[') {
      const labelEnd = next[']'][index]!;
      if (labelEnd > index + 1 && text[labelEnd + 1] === '(') {
        const hrefStart = labelEnd + 2;
        const hrefEnd = next[')'][labelEnd + 1]!;
        const space = next.space[labelEnd + 1]!;
        if (hrefEnd > hrefStart && (space === -1 || space > hrefEnd)) {
          token = { kind: 'link', text: text.slice(index + 1, labelEnd), href: text.slice(hrefStart, hrefEnd), index };
          end = hrefEnd + 1;
        }
      }
    } else if (character === '*' || character === '_' || character === '`') {
      const doubled = character !== '`' && text[index + 1] === character;
      const contentStart = index + (doubled ? 2 : 1);
      const closing = next[character][contentStart - 1]!;
      if (closing > contentStart && (!doubled || text[closing + 1] === character)) {
        token = { kind: character === '`' ? 'code' : doubled ? 'strong' : 'em', text: text.slice(contentStart, closing), index };
        end = closing + (doubled ? 2 : 1);
      }
    }
    if (!token) { index++; continue; }
    if (index > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, index) });
    tokens.push(token);
    cursor = end;
    index = end;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens;
}
