/** Initials for a no-photo state ("Max Verstappen" -> "MV", "Kimi Räikkönen" -> "KR"). Server-safe. */
export function initialsOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/[\s-]+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return '';
  const first = words[0]!.match(/\p{L}/u)?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]!.match(/\p{L}/u)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
