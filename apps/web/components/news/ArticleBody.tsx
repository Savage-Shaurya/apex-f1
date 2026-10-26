import type { ReactNode } from 'react';
import { Media } from '@/components/ds';
import { tokenizeArticleInline } from '@/lib/article-inline';

function safeLink(value: string): boolean {
  return /^(https?:\/\/|mailto:|#)/i.test(value) || (value.startsWith('/') && !value.startsWith('//'));
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const token of tokenizeArticleInline(text)) {
    if (token.kind === 'text') { nodes.push(token.text); continue; }
    const key = `inline-${token.index}`;
    if (token.kind === 'link') {
      const external = /^https?:/i.test(token.href);
      nodes.push(safeLink(token.href)
        ? (
          <a
            key={key}
            href={token.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-fg underline decoration-[var(--rule-strong)] decoration-1 underline-offset-[0.18em] transition-colors hover:text-accent hover:decoration-[var(--accent-text)]"
          >
            {token.text}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        )
        : <span key={key}>{token.text}</span>);
    } else if (token.kind === 'strong') nodes.push(<strong key={key} className="font-[650] text-fg">{token.text}</strong>);
    else if (token.kind === 'em') nodes.push(<em key={key}>{token.text}</em>);
    else nodes.push(<code key={key} className="bg-tone-raised px-1.5 py-0.5 font-text text-[0.9em] font-[650] text-fg">{token.text}</code>);
  }
  return nodes;
}

/**
 * A small, safe editorial Markdown subset (raw HTML is always escaped as
 * text), set for the reading measure: Hanken body in full ink, Hanken
 * headings from the type scale, Garamond pull quotes, and figures that keep
 * the whole picture with the caption below it.
 */
export function ArticleBody({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) { index++; continue; }
    const key = `block-${index}`;
    if (line.startsWith('```')) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push(
        <pre key={key} tabIndex={0} aria-label="Code sample" className="my-8 overflow-x-auto bg-tone-raised p-5 font-text text-small leading-relaxed text-fg">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
    if (image) {
      blocks.push(
        <div key={key} className="my-12 lg:-mx-[clamp(0rem,6vw,6rem)]">
          <Media src={image[2]} alt={image[1] ?? ''} kind="wide" caption={image[1] || undefined} sizes="(min-width: 1024px) 880px, 100vw" />
        </div>,
      );
      index++; continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const content = inline(heading[2]!);
      const depth = heading[1]!.length;
      blocks.push(depth <= 2
        ? <h2 key={key} className="mb-5 mt-16 font-text text-heading-l text-fg text-balance">{content}</h2>
        : depth === 3
          ? <h3 key={key} className="mb-4 mt-12 font-text text-heading-m text-fg text-balance">{content}</h3>
          : <h4 key={key} className="mb-3 mt-10 font-text text-label-l uppercase text-fg-2">{content}</h4>);
      index++; continue;
    }
    if (/^([-*_])(?:\s*\1){2,}$/.test(line)) {
      blocks.push(<hr key={key} className="my-14 h-px border-0 bg-[var(--rule-strong)]" />); index++; continue;
    }
    const list = line.match(/^(?:[-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(line);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const next = lines[index]!.trim().match(ordered ? /^\d+[.)]\s+(.+)$/ : /^[-+*]\s+(.+)$/);
        if (!next) break;
        items.push(<li key={index} className="pl-2">{inline(next[1]!)}</li>);
        index++;
      }
      blocks.push(ordered
        ? <ol key={key} className="mb-7 list-decimal space-y-2.5 pl-6 marker:font-[650] marker:text-fg-3">{items}</ol>
        : <ul key={key} className="mb-7 list-disc space-y-2.5 pl-6 marker:text-brand-red">{items}</ul>);
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith('>')) quote.push(lines[index++]!.trim().replace(/^>\s?/, ''));
      blocks.push(
        <blockquote key={key} className="ds-editorial my-14 pl-6 font-editorial text-[clamp(1.5rem,1.1rem+1.4vw,2.25rem)] leading-[1.24] tracking-[0em] text-fg shadow-[inset_3px_0_0_var(--color-brand-red)] text-pretty">
          {inline(quote.join(' '))}
        </blockquote>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index]!.trim() && !/^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```|!\[)/.test(lines[index]!.trim())) paragraph.push(lines[index++]!.trim());
    blocks.push(<p key={key} className="mb-7 text-pretty">{inline(paragraph.join(' '))}</p>);
  }
  return <div className="font-text text-body text-fg [&>*:first-child]:mt-0">{blocks}</div>;
}
