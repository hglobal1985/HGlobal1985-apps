/** 色彩轉換（品牌 logo 底色的「變淡」「色彩飽和度」滑桿用）：#RRGGBB ⇄ HSL（h 0～360、s 0～100、l 0～100）。 */
export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const n = parseInt(m ? m[1]! : "FFFFFF", 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(((h * 60 + 360) % 360) * 10) / 10, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const S = Math.min(1, Math.max(0, s / 100));
  const L = Math.min(1, Math.max(0, l / 100));
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}
