export type HeatmapPalette = 'thermal' | 'viridis' | 'amber';

interface RgbStop {
  t: number;
  r: number;
  g: number;
  b: number;
}

const PALETTES: Record<HeatmapPalette, RgbStop[]> = {
  thermal: [
    { t: 0.0, r: 30, g: 58, b: 138 },   // deep blue
    { t: 0.28, r: 14, g: 165, b: 233 }, // sky cyan
    { t: 0.52, r: 34, g: 197, b: 94 },  // emerald
    { t: 0.74, r: 245, g: 158, b: 11 }, // amber
    { t: 0.9, r: 239, g: 68, b: 68 },   // crimson
    { t: 1.0, r: 185, g: 28, b: 28 },   // deep red
  ],
  viridis: [
    { t: 0.0, r: 68, g: 1, b: 84 },
    { t: 0.25, r: 59, g: 82, b: 139 },
    { t: 0.5, r: 33, g: 145, b: 140 },
    { t: 0.75, r: 94, g: 201, b: 98 },
    { t: 1.0, r: 253, g: 231, b: 37 },
  ],
  amber: [
    { t: 0.0, r: 241, g: 245, b: 249 },
    { t: 0.25, r: 254, g: 243, b: 199 },
    { t: 0.55, r: 251, g: 191, b: 36 },
    { t: 0.8, r: 234, g: 88, b: 12 },
    { t: 1.0, r: 153, g: 27, b: 27 },
  ],
};

export function sampleHeatmapRgb(
  value: number,
  palette: HeatmapPalette = 'thermal'
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  const stops = PALETTES[palette];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      const f = (clamped - a.t) / span;
      return [
        Math.round(a.r + (b.r - a.r) * f),
        Math.round(a.g + (b.g - a.g) * f),
        Math.round(a.b + (b.b - a.b) * f),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

export function heatmapCssGradient(palette: HeatmapPalette = 'thermal'): string {
  const stops = PALETTES[palette]
    .map((s) => `rgb(${s.r}, ${s.g}, ${s.b}) ${Math.round(s.t * 100)}%`)
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

/**
 * Returns accessible matrix cell background + foreground colors for light and dark themes.
 */
export function getMatrixCellColors(
  ratio: number,
  isDark: boolean,
  palette: HeatmapPalette = 'thermal'
): { bg: string; text: string } {
  const r = Math.max(0, Math.min(1, ratio));
  if (r <= 0.02) {
    return isDark
      ? { bg: 'rgba(30, 41, 59, 0.55)', text: '#64748B' }
      : { bg: '#F8FAFC', text: '#94A3B8' };
  }

  const [red, green, blue] = sampleHeatmapRgb(r, palette);
  const alpha = isDark ? 0.25 + r * 0.65 : 0.16 + r * 0.74;
  const bg = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;

  // Compute perceived luminance against the page surface to guarantee WCAG AA text legibility
  const baseLum = isDark ? 15 : 255;
  const effR = red * alpha + baseLum * (1 - alpha);
  const effG = green * alpha + baseLum * (1 - alpha);
  const effB = blue * alpha + baseLum * (1 - alpha);
  const luminance = (0.299 * effR + 0.587 * effG + 0.114 * effB) / 255;

  return {
    bg,
    text: luminance > 0.56 ? '#0F172A' : '#F8FAFC',
  };
}
