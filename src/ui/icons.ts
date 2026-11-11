import type { GlyphName, Icon } from '@/core/types';

// 24px stroke icons, drawn for MoonCow in a Lucide-like style.
const PATHS: Record<GlyphName, string[]> = {
  calc: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 7h8', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01', 'M8 16h.01', 'M12 16h.01', 'M16 16h.01'],
  convert: ['M7 7h11l-3-3', 'M17 17H6l3 3'],
  color: ['M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z', 'M7.5 11.5h.01', 'M10 7.5h.01', 'M14.5 7.5h.01'],
  book: ['M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z', 'M4 20a2 2 0 0 0 2 1h13v-3'],
  cloud: ['M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.75 3.75 0 0 1 17.5 18z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z'],
  tab: ['M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 9h16'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  bookmark: ['M6 4h12v17l-6-4-6 4z'],
  key: ['M15 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M10.5 13.5 3 21', 'M5 19l2 2', 'M8 16l2 2'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 4 8 20', 'M16 4l-2 16'],
  dice: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 8h.01', 'M16 8h.01', 'M12 12h.01', 'M8 16h.01', 'M16 16h.01'],
  text: ['M4 6V4h16v2', 'M12 4v16', 'M9 20h6'],
  gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  reload: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 18h2v2h-2z', 'M18 14h2', 'M14 18v2'],
  mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
  code: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M14 5l-4 14'],
  box: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function glyph(name: GlyphName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name] || PATHS.search) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

let siteIconResolver: (url: string) => string | null = () => null;

/** How `{ site }` icons become images. Set by the environment; defaults to none. */
export function setSiteIconResolver(fn: (url: string) => string | null): void {
  siteIconResolver = fn;
}

function imageIcon(wrap: HTMLElement, src: string): void {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  img.addEventListener('error', () => {
    img.remove();
    wrap.appendChild(glyph('globe'));
  }, { once: true });
  wrap.appendChild(img);
}

export function renderIcon(icon: Icon | undefined): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'icon';
  if (!icon) {
    wrap.appendChild(glyph('search'));
  } else if ('glyph' in icon) {
    wrap.appendChild(glyph(icon.glyph));
  } else if ('swatch' in icon) {
    wrap.classList.add('icon-swatch');
    wrap.style.background = icon.swatch;
  } else if ('site' in icon) {
    const src = siteIconResolver(icon.site);
    if (src) imageIcon(wrap, src);
    else wrap.appendChild(glyph('globe'));
  } else {
    imageIcon(wrap, icon.image);
  }
  return wrap;
}
