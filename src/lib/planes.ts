import { mix, shade } from './color';
import { fibonacciProfile } from './terrain';
import type { PaletteColor } from './types';

// Planos de profundidad 2.5D (estilo REPLACED): el cuadro no es un telón,
// es un mundo con capas. Todo se genera desde la paleta de la imagen.

export interface DepthPlanes {
  sky: HTMLCanvasElement; // fondo atmosférico fijo
  far: HTMLCanvasElement; // montañas lejanas, parallax 0.22
  mid: HTMLCanvasElement; // colinas medias, parallax 0.5
  fore: HTMLCanvasElement; // siluetas en primer plano, parallax 1.35
}

export const PARALLAX = { far: 0.22, mid: 0.5, fore: 1.35 };

function makeLayer(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  return [c, ctx];
}

// silueta de perfil fibonacci rellena hasta el piso
function silhouette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  baseY: number,
  amp: number,
  color: string,
): void {
  const cols = 220;
  const prof = fibonacciProfile(cols, seed);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let c = 0; c <= cols; c++) {
    const x = (c / cols) * w;
    const y = baseY - prof[Math.min(cols - 1, c)] * amp;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

export function buildPlanes(
  W: number,
  H: number,
  palette: PaletteColor[],
  seed: number,
): DepthPlanes {
  const skyTopSrc = palette[Math.min(1, palette.length - 1)].hex;
  const skyTop = shade(skyTopSrc, 0.3);
  const skyBottom = '#0b0e15';
  const darkest = palette.reduce((a, b) => (a.light < b.light ? a : b)).hex;

  // --- cielo: gradiente del cuadro + estrellas discretas ---
  const [sky, sctx] = makeLayer(W, H);
  const grad = sctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, skyTop);
  grad.addColorStop(0.65, mix(skyTop, skyBottom, 0.7));
  grad.addColorStop(1, skyBottom);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, W, H);
  let hash = seed >>> 1 || 7;
  sctx.fillStyle = '#e8e4f2';
  for (let i = 0; i < 46; i++) {
    hash = (hash * 16807) % 2147483647;
    const x = hash % W;
    hash = (hash * 16807) % 2147483647;
    const y = (hash % Math.round(H * 0.55)) + 4;
    sctx.globalAlpha = 0.12 + (i % 5) * 0.05;
    sctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
  }
  sctx.globalAlpha = 1;

  // --- montañas lejanas: casi del color del cielo, con bruma en la base ---
  const farW = W * 2;
  const [far, fctx] = makeLayer(farW, H);
  const farColor = mix(shade(palette[0].hex, 0.4), skyTop, 0.55);
  silhouette(fctx, farW, H, seed + 7, H * 0.9, H * 0.42, farColor);
  const haze = fctx.createLinearGradient(0, H * 0.55, 0, H);
  haze.addColorStop(0, 'rgba(11,14,21,0)');
  haze.addColorStop(1, 'rgba(11,14,21,0.55)');
  fctx.fillStyle = haze;
  fctx.fillRect(0, 0, farW, H);

  // --- colinas medias: un paso más presentes ---
  const midW = W * 2;
  const [mid, mctx] = makeLayer(midW, H);
  const midColor = mix(shade(palette[Math.min(2, palette.length - 1)].hex, 0.34), skyBottom, 0.35);
  silhouette(mctx, midW, H, seed + 13, H * 0.99, H * 0.34, midColor);

  // --- primer plano: siluetas casi negras que pasan por delante ---
  const foreW = W * 1.6;
  const [fore, xctx] = makeLayer(foreW, H);
  const foreColor = shade(darkest, 0.14);
  // banda de suelo
  silhouette(xctx, foreW, H, seed + 29, H * 1.06, H * 0.1, foreColor);
  // cipreses/agujas: llamas oscuras a intervalos irregulares
  let h2 = (seed ^ 0x2f) >>> 0 || 13;
  xctx.fillStyle = foreColor;
  for (let i = 0; i < 7; i++) {
    h2 = (h2 * 16807) % 2147483647;
    const bx = (h2 % foreW) | 0;
    h2 = (h2 * 16807) % 2147483647;
    const th = H * (0.18 + (h2 % 100) / 100 * 0.3);
    const bw = 10 + (h2 % 18);
    xctx.beginPath();
    xctx.moveTo(bx - bw / 2, H);
    xctx.quadraticCurveTo(bx - bw * 0.32, H - th * 0.55, bx, H - th);
    xctx.quadraticCurveTo(bx + bw * 0.32, H - th * 0.55, bx + bw / 2, H);
    xctx.closePath();
    xctx.fill();
  }

  return { sky, far, mid, fore };
}
