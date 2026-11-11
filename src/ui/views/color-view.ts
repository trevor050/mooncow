import type { View } from '@/core/types';
import { contrastRatio, formatHsl, formatRgb, parseColor, scale, toHex, type Rgba } from '@/lib/color';
import { clear, h } from '../dom';
import { glyph } from '../icons';

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function grade(ratio: number): string {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'Fail';
}

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

export function colorView(initial: Rgba): View {
  return {
    id: 'color',
    title: 'Color picker',
    mount(root, ctx) {
      let color = initial;
      const swatch = h('div', { class: 'swatch-big' });
      const picker = h('input', { type: 'color', class: 'native-picker', 'aria-label': 'Pick a color' });
      const text = h('input', { class: 'field mono', type: 'text', spellcheck: 'false', 'aria-label': 'Color value', autofocus: true });
      const values = h('div', { class: 'color-values' });
      const ramp = h('div', { class: 'ramp', role: 'group', 'aria-label': 'Tints and shades' });
      const contrast = h('div', { class: 'contrast' });
      const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
      const dropBtn = Dropper ? h('button', { class: 'ghost', type: 'button' }, glyph('color', 14), 'Pick from screen') : null;

      root.append(
        h('div', { class: 'color-view' },
          h('div', { class: 'color-top' }, swatch, h('div', { class: 'color-inputs' }, text, h('div', { class: 'row-inline' }, picker, dropBtn))),
          values, ramp, contrast,
        ),
      );

      const copyRow = (label: string, value: string) => {
        const btn = h('button', { class: 'value-row', type: 'button', title: `Copy ${label}` }, h('span', { class: 'value-label' }, label), h('span', { class: 'mono' }, value), glyph('copy', 14));
        btn.addEventListener('click', async () => { await ctx.copy(value); ctx.toast(`Copied ${value}`); });
        return btn;
      };

      function paint(from: 'text' | 'other') {
        const hex = toHex(color);
        swatch.style.background = hex;
        picker.value = hex.slice(0, 7).toLowerCase();
        if (from !== 'text') text.value = hex;
        clear(values);
        values.append(copyRow('HEX', hex), copyRow('RGB', formatRgb(color)), copyRow('HSL', formatHsl(color)));
        clear(ramp);
        for (const step of scale(color)) {
          const b = h('button', { class: 'ramp-step', type: 'button', title: step, 'aria-label': step });
          b.style.background = step;
          b.addEventListener('click', () => { color = parseColor(step)!; paint('other'); });
          ramp.append(b);
        }
        clear(contrast);
        for (const [label, bg] of [['on white', WHITE], ['on black', BLACK]] as const) {
          const ratio = contrastRatio(color, bg);
          contrast.append(h('div', { class: 'contrast-cell' }, h('span', { class: 'mono' }, `${ratio.toFixed(2)}:1`), ` ${label} · `, h('strong', {}, grade(ratio))));
        }
      }

      text.addEventListener('input', () => {
        const parsed = parseColor(text.value) || parseColor('#' + text.value.replace(/^#/, ''));
        text.classList.toggle('invalid', !parsed);
        if (parsed) { color = parsed; paint('text'); }
      });
      text.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); await ctx.copy(toHex(color)); ctx.toast(`Copied ${toHex(color)}`); }
      });
      picker.addEventListener('input', () => { color = parseColor(picker.value)!; paint('other'); });
      dropBtn?.addEventListener('click', async () => {
        try {
          const res = await new Dropper!().open();
          color = parseColor(res.sRGBHex)!;
          paint('other');
        } catch {}
      });
      paint('other');
      text.select();
    },
  };
}
