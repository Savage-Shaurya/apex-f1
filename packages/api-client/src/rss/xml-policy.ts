/** Reject active DTDs without treating inert article examples as declarations. */
export function hasXmlDoctype(xml: string): boolean {
  let cursor = 0;
  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor);
    if (opening < 0) return false;
    let terminator: string | null = null;
    let start = opening;
    if (xml.startsWith('<![CDATA[', opening)) { terminator = ']]>'; start += 9; }
    else if (xml.startsWith('<!--', opening)) { terminator = '-->'; start += 4; }
    else if (xml.startsWith('<?', opening)) { terminator = '?>'; start += 2; }
    if (terminator) {
      const end = xml.indexOf(terminator, start);
      // XMLValidator handles malformed unterminated blocks before parsing.
      if (end < 0) return false;
      cursor = end + terminator.length;
      continue;
    }
    if (xml.slice(opening, opening + 9).toUpperCase() === '<!DOCTYPE') return true;
    cursor = opening + 1;
  }
  return false;
}
