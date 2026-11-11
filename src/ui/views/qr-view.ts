import qrcode from 'qrcode-generator';
import type { View } from '@/core/types';
import { h } from '../dom';
import { glyph } from '../icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

// The library's default Byte encoder truncates UTF-16 code units to 8 bits.
// Encode Unicode as UTF-8 so scanning reproduces the original text.
qrcode.stringToBytes = (text: string) => Array.from(new TextEncoder().encode(text));

/** Build a QR code as SVG nodes; generated locally, nothing is sent anywhere. */
export function qrSvg(text: string, size = 220): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#fff');
  svg.appendChild(bg);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.appendChild(path);
  return svg;
}

export function qrView(text: string | null): View {
  return {
    id: 'qr',
    title: 'QR code',
    mount(root, ctx) {
      const wrap = h('div', { class: 'qr-view' });
      root.append(wrap);
      void (async () => {
        const content = text ?? (await ctx.browser.pageInfo())?.url ?? '';
        if (!content) {
          wrap.append(h('p', { class: 'muted' }, 'Nothing to encode. Try “qr some text”.'));
          return;
        }
        let svg: SVGSVGElement;
        try {
          svg = qrSvg(content);
        } catch {
          wrap.append(h('p', { class: 'muted' }, 'That is too long for a QR code.'));
          return;
        }
        const copy = h('button', { class: 'ghost', type: 'button', autofocus: true }, glyph('copy', 14), 'Copy text');
        copy.addEventListener('click', async () => { await ctx.copy(content); ctx.toast('Copied'); });
        const save = h('button', { class: 'ghost', type: 'button' }, 'Save SVG');
        save.addEventListener('click', () => {
          const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'mooncow-qr.svg' });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        });
        wrap.append(h('div', { class: 'qr-code' }, svg), h('p', { class: 'qr-text mono' }, content), h('div', { class: 'row-inline' }, copy, save));
        copy.focus();
      })();
    },
  };
}
