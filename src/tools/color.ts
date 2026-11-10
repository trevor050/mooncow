import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { formatHsl, formatRgb, parseColor, toHex, type Rgba } from '@/lib/color';
import { colorView } from '@/ui/views/color-view';

function colorResult(color: Rgba, relevance: number): Result {
  const hex = toHex(color);
  return {
    id: `color:${hex}`,
    kind: 'answer',
    title: hex,
    subtitle: `${formatRgb(color)} · ${formatHsl(color)}`,
    icon: { swatch: hex },
    relevance,
    accessory: 'Copy',
    actions: [
      copyAction(hex, 'Copy HEX'),
      { title: 'Open color picker', run: (ctx) => ctx.showView(colorView(color)) },
      copyAction(formatRgb(color), 'Copy RGB'),
      copyAction(formatHsl(color), 'Copy HSL'),
    ],
  };
}

export default defineTool({
  id: 'color',
  name: 'Color',
  description: 'Convert hex, rgb() and hsl() colors, or open a picker with tints, shades and contrast.',
  examples: ['#ff8800', 'rgb(30 144 255)', 'hsl(210, 80%, 50%)', 'color picker'],
  match(q) {
    if (q.is('color', 'colour', 'color picker', 'colour picker', 'pick color', 'pick a color', 'eyedropper')) {
      return {
        id: 'picker',
        kind: 'command',
        title: 'Color picker',
        subtitle: 'Pick, convert and check contrast',
        icon: { glyph: 'color' },
        relevance: RELEVANCE.explicit,
        actions: [{ title: 'Open', run: (ctx) => ctx.showView(colorView({ r: 255, g: 136, b: 0, a: 1 })) }],
      };
    }
    const explicit = q.commandWithArg('color', 'colour', 'hex');
    const color = parseColor(explicit ?? q.text) ?? (explicit && /^[0-9a-f]{3,8}$/i.test(explicit) ? parseColor('#' + explicit) : null);
    return color ? colorResult(color, explicit ? RELEVANCE.explicit : RELEVANCE.parsed) : null;
  },
});
