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
  viewW: number,
  worldW: number,
  H: number,
  palette: PaletteColor[],
  seed: number,
): DepthPlanes {
  const skyTopSrc = palette[Math.min(1, palette.length - 1)].hex;
  const skyTop = shade(skyTopSrc, 0.3);
  const skyBottom = '#0b0e15';
  const darkest = palette.reduce((a, b) => (a.light < b.light ? a : b)).hex;
  // cada plano debe cubrir el recorrido completo de la cámara a su velocidad
  const planeW = (f: number) => viewW + (worldW - viewW) * f;

  // --- cielo: gradiente del cuadro + estrellas discretas ---
  const [sky, sctx] = makeLayer(viewW, H);
  const grad = sctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, skyTop);
  grad.addColorStop(0.65, mix(skyTop, skyBottom, 0.7));
  grad.addColorStop(1, skyBottom);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, viewW, H);
  let hash = seed >>> 1 || 7;
  sctx.fillStyle = '#e8e4f2';
  for (let i = 0; i < 46; i++) {
    hash = (hash * 16807) % 2147483647;
    const x = hash % viewW;
    hash = (hash * 16807) % 2147483647;
    const y = (hash % Math.round(H * 0.55)) + 4;
    sctx.globalAlpha = 0.12 + (i % 5) * 0.05;
    sctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
  }
  sctx.globalAlpha = 1;

  // --- montañas lejanas: casi del color del cielo, con bruma en la base ---
  const farW = planeW(PARALLAX.far);
  const [far, fctx] = makeLayer(farW, H);
  const farColor = mix(shade(palette[0].hex, 0.4), skyTop, 0.55);
  silhouette(fctx, farW, H, seed + 7, H * 0.9, H * 0.42, farColor);
  const haze = fctx.createLinearGradient(0, H * 0.55, 0, H);
  haze.addColorStop(0, 'rgba(11,14,21,0)');
  haze.addColorStop(1, 'rgba(11,14,21,0.55)');
  fctx.fillStyle = haze;
  fctx.fillRect(0, 0, farW, H);

  // --- colinas medias: un paso más presentes ---
  const midW = planeW(PARALLAX.mid);
  const [mid, mctx] = makeLayer(midW, H);
  const midColor = mix(shade(palette[Math.min(2, palette.length - 1)].hex, 0.34), skyBottom, 0.35);
  silhouette(mctx, midW, H, seed + 13, H * 0.99, H * 0.34, midColor);

  // --- primer plano: siluetas casi negras que pasan por delante ---
  const foreW = planeW(PARALLAX.fore);
  const [fore, xctx] = makeLayer(foreW, H);
  const foreColor = shade(darkest, 0.14);
  // banda de suelo
  silhouette(xctx, foreW, H, seed + 29, H * 1.06, H * 0.1, foreColor);
  // cipreses/agujas: llamas oscuras a intervalos irregulares
  let h2 = (seed ^ 0x2f) >>> 0 || 13;
  xctx.fillStyle = foreColor;
  for (let i = 0; i < 16; i++) {
    h2 = (h2 * 16807) % 2147483647;
    const bx = (h2 % foreW) | 0;
    h2 = (h2 * 16807) % 2147483647;
    const th = H * (0.18 + ((h2 % 100) / 100) * 0.3);
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

// --- decoración del mundo jugable: árboles de ramificación áurea, fósiles
// espirales y juncos, todos nacidos de la paleta del cuadro ---

const GOLDEN_ANGLE = 2.39996; // el ángulo áureo, en radianes

function branch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
  depth: number,
  tint: string,
  trunk: string,
): void {
  if (depth <= 0 || len < 3) {
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.globalAlpha = 1;
    return;
  }
  const nx = x + Math.cos(angle) * len;
  const ny = y - Math.sin(angle) * len;
  ctx.strokeStyle = trunk;
  ctx.lineWidth = Math.max(1, width);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  const PHI = 1.618;
  branch(ctx, nx, ny, angle + GOLDEN_ANGLE * 0.28, len / PHI, width * 0.7, depth - 1, tint, trunk);
  branch(ctx, nx, ny, angle - GOLDEN_ANGLE * 0.2, len / PHI ** 0.72, width * 0.75, depth - 1, tint, trunk);
}

function ammonite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let t = 0; t < Math.PI * 2 * 2.6; t += 0.12) {
    const r = size * Math.pow(1.618, t / (Math.PI * 2)) * 0.28;
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r * 0.85;
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function buildDecor(
  worldW: number,
  H: number,
  floorY: number,
  palette: PaletteColor[],
  seed: number,
): HTMLCanvasElement {
  const [decor, ctx] = makeLayer(worldW, H);
  const trunk = shade(palette.reduce((a, b) => (a.light < b.light ? a : b)).hex, 0.3);
  let h = (seed ^ 0x77) >>> 0 || 21;
  const rnd = () => {
    h = (h * 16807) % 2147483647;
    return h / 2147483647;
  };

  // árboles de ramificación áurea, con hojas del color del cuadro
  for (let t = 0; t < 7; t++) {
    const x = worldW * (0.04 + 0.92 * ((t * 0.618034 + 0.31) % 1));
    const size = 34 + rnd() * 40;
    const tint = palette[Math.floor(rnd() * palette.length)].hex;
    branch(ctx, x, floorY + 4, Math.PI / 2 + (rnd() - 0.5) * 0.3, size, 4, 6, tint, trunk);
  }
  // fósiles espirales semienterrados
  for (let f = 0; f < 6; f++) {
    const x = worldW * ((f * 0.618034 + 0.07) % 1);
    ammonite(ctx, x, floorY - 4 - rnd() * 8, 16 + rnd() * 18, shade(palette[f % palette.length].hex, 0.75));
  }
  // juncos: manojos de líneas que se curvan
  ctx.strokeStyle = shade(palette[Math.min(2, palette.length - 1)].hex, 0.5);
  ctx.lineWidth = 1.2;
  for (let r = 0; r < 26; r++) {
    const x = worldW * rnd();
    const hgt = 10 + rnd() * 22;
    const sway = (rnd() - 0.5) * 10;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, floorY + 4);
    ctx.quadraticCurveTo(x + sway * 0.3, floorY - hgt * 0.6, x + sway, floorY - hgt);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return decor;
}
