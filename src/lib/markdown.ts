// Markdown for AI answers, rendered straight to DOM nodes.
//
// Model output is untrusted text, so this never builds an HTML string: every
// piece of text becomes a text node and only a fixed set of elements is
// created. Links are limited to http(s) and open in a new tab.
//
// Supported: headings, paragraphs, bold, italic, inline code, fenced code,
// bullet and numbered lists, block quotes, links, horizontal rules.

type Doc = Document;

function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;

export function renderInline(doc: Doc, text: string, parent: Node): void {
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      parent.appendChild(doc.createTextNode(rest));
      return;
    }
    if (m.index > 0) parent.appendChild(doc.createTextNode(rest.slice(0, m.index)));
    const token = m[0];
    if (m[1]) {
      const code = doc.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (m[2]) {
      const strong = doc.createElement('strong');
      renderInline(doc, token.slice(2, -2), strong);
      parent.appendChild(strong);
    } else if (m[3]) {
      const em = doc.createElement('em');
      renderInline(doc, token.slice(1, -1), em);
      parent.appendChild(em);
    } else if (m[4]) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) || [];
      const url = href ? safeHref(href) : null;
      if (url) {
        const a = doc.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        renderInline(doc, label, a);
        parent.appendChild(a);
      } else {
        parent.appendChild(doc.createTextNode(label || token));
      }
    }
    rest = rest.slice(m.index + token.length);
  }
}

export function renderMarkdown(doc: Doc, source: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    const p = doc.createElement('p');
    renderInline(doc, paragraph.join(' '), p);
    frag.appendChild(p);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      if (fence[2]) code.dataset.lang = fence[2];
      code.textContent = body.join('\n');
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);
      const h = doc.createElement(`h${level}`);
      renderInline(doc, heading[2], h);
      frag.appendChild(h);
      i++;
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flush();
      frag.appendChild(doc.createElement('hr'));
      i++;
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      flush();
      const ordered = /\d/.test(listMatch[1]);
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const item = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!item || /\d/.test(item[1]) !== ordered) break;
        const li = doc.createElement('li');
        renderInline(doc, item[2], li);
        list.appendChild(li);
        i++;
      }
      frag.appendChild(list);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = doc.createElement('blockquote');
      bq.appendChild(renderMarkdown(doc, quote.join('\n')));
      frag.appendChild(bq);
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return frag;
}
