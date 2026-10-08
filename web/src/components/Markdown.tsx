import type { ReactNode } from 'react';

/**
 * Tiny, safe markdown: paragraphs, fenced code blocks, bullet / numbered lists, headings,
 * inline `code`, **bold** and links. Everything is rendered as React text nodes — no raw HTML.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="tx-text">{blocks(text)}</div>;
}

function blocks(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      out.push(<pre key={key++}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(<h4 key={key++}>{inline(heading[1])}</h4>);
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*+]\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      out.push(<ul key={key++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(/^\s*(\d+)/)![1]);
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      out.push(<ol key={key++} start={start}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*```/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])
    ) para.push(lines[i++].trim());
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return out;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `code`, **bold**, [label](https://url)
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<code key={k++}>{m[1]}</code>);
    else if (m[2] != null) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<a key={k++} href={m[4]} target="_blank" rel="noreferrer noopener">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
