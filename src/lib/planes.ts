import { mix, shade, saturate } from './color';
import { fibonacciProfile } from './terrain';
import type { PaletteColor } from './types';

// Planos de profundidad 2.5D (estilo REPLACED): el cuadro no es un telón,
// es un mundo con capas. Todo se genera desde la paleta de la imagen.

export interface DepthPlanes {
  sky: HTMLCanvasElement; // fondo atmosférico fijo (luna, nubes, vía láctea)
  far: HTMLCanvasElement; // montañas lejanas, parallax 0.22
  mid: HTMLCanvasElement; // colinas medias + el castillo de la Pinacoteca, parallax 0.5
  fore: HTMLCanvasElement; // siluetas en primer plano, parallax 1.35
  vignette: HTMLCanvasElement; // viñeta nocturna, espacio de pantalla
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

// silueta de perfil fibonacci rellena hasta el piso; devuelve el contorno
// para poder apoyar cosas encima (el castillo, por ejemplo)
function silhouette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  baseY: number,
  amp: number,
  color: string,
): Float32Array {
  const cols = 220;
  const prof = fibonacciProfile(cols, seed);
  const ys = new Float32Array(cols + 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let c = 0; c <= cols; c++) {
    const x = (c / cols) * w;
    const y = baseY - prof[Math.min(cols - 1, c)] * amp;
    ys[c] = y;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  return ys;
}

// el castillo de la Pinacoteca: torres, almenas, techos cónicos con
// estandartes y ventanas encendidas — alguien vive ahí
function castle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  h: number,
  body: string,
  windowColor: string,
): void {
  const roof = shade(body, 0.7);
  const tower = (x: number, w: number, th: number) => {
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2, groundY - th, w, th + 8);
    // almenas
    for (let a = -w / 2; a < w / 2; a += 6) {
      ctx.fillRect(x + a, groundY - th - 4, 3.4, 5);
    }
    // techo cónico
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 3, groundY - th - 2);
    ctx.lineTo(x, groundY - th - w * 1.15);
    ctx.lineTo(x + w / 2 + 3, groundY - th - 2);
    ctx.closePath();
    ctx.fill();
    // estandarte
    ctx.strokeStyle = roof;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, groundY - th - w * 1.15);
    ctx.lineTo(x, groundY - th - w * 1.15 - 9);
    ctx.stroke();
    ctx.fillStyle = windowColor;
    ctx.beginPath();
    ctx.moveTo(x, groundY - th - w * 1.15 - 9);
    ctx.lineTo(x + 7, groundY - th - w * 1.15 - 6.5);
    ctx.lineTo(x, groundY - th - w * 1.15 - 4);
    ctx.closePath();
    ctx.fill();
    // ventanas encendidas
    ctx.fillStyle = windowColor;
    for (let wy = groundY - th + 8; wy < groundY - 8; wy += 13) {
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 1.5, wy, 3, 4.5);
      ctx.globalAlpha = 1;
    }
  };
  // muralla entre torres
  ctx.fillStyle = body;
  ctx.fillRect(cx - h * 0.52, groundY - h * 0.34, h * 1.04, h * 0.34 + 8);
  for (let a = -h * 0.52; a < h * 0.52; a += 7) {
    ctx.fillRect(cx + a, groundY - h * 0.34 - 4, 4, 5);
  }
  tower(cx - h * 0.52, h * 0.26, h * 0.62);
  tower(cx + h * 0.52, h * 0.26, h * 0.62);
  tower(cx, h * 0.34, h); // torre del homenaje
}

export function buildPlanes(
  viewW: number,
  worldW: number,
  H: number,
  palette: PaletteColor[],
  seed: number,
): DepthPlanes {
  // paleta saturada: la noche es intensa, no gris
  const skyTopSrc = saturate(palette[Math.min(1, palette.length - 1)].hex, 1.5);
  const skyTop = shade(skyTopSrc, 0.42);
  const skyBottom = '#0a0d1c';
  const darkest = palette.reduce((a, b) => (a.light < b.light ? a : b)).hex;
  const moonlight = '#dce8ff';
  const warm = '#f2c46a';
  // cada plano debe cubrir el recorrido completo de la cámara a su velocidad
  const planeW = (f: number) => viewW + (worldW - viewW) * f;

  // --- cielo nocturno: gradiente, vía láctea, estrellas, nubes y luna ---
  const [sky, sctx] = makeLayer(viewW, H);
  const grad = sctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(skyTopSrc, 0.32));
  grad.addColorStop(0.45, skyTop);
  grad.addColorStop(0.8, mix(skyTop, skyBottom, 0.65));
  grad.addColorStop(1, skyBottom);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, viewW, H);

  let hash = seed >>> 1 || 7;
  const rnd = () => {
    hash = (hash * 16807) % 2147483647;
    return hash / 2147483647;
  };

  // vía láctea: banda diagonal de polvo estelar
  sctx.fillStyle = '#cfd8f2';
  for (let i = 0; i < 260; i++) {
    const t = rnd();
    const spread = (rnd() - 0.5) * H * 0.22;
    const x = viewW * (0.1 + 0.8 * t);
    const y = H * (0.62 - 0.42 * t) + spread;
    if (y < 0 || y > H * 0.7) continue;
    sctx.globalAlpha = 0.05 + rnd() * 0.1;
    sctx.fillRect(x, y, 1.4, 1.4);
  }

  // estrellas: tamaños y brillos variados
  for (let i = 0; i < 110; i++) {
    const x = rnd() * viewW;
    const y = rnd() * H * 0.6 + 3;
    const big = i % 13 === 0;
    sctx.globalAlpha = big ? 0.85 : 0.15 + rnd() * 0.4;
    sctx.fillStyle = big ? '#fff6e0' : '#e8e4f2';
    sctx.fillRect(x, y, big ? 2.4 : 1.3, big ? 2.4 : 1.3);
    if (big) {
      sctx.globalAlpha = 0.25;
      sctx.fillRect(x - 3, y + 0.5, 8.4, 1);
      sctx.fillRect(x + 0.5, y - 3, 1, 8.4);
    }
  }
  sctx.globalAlpha = 1;

  // la luna: halo doble, disco y cráteres
  const mx = viewW * 0.66;
  const my = H * 0.2;
  const mr = Math.min(H * 0.085, 56);
  const haloGrad = sctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4.2);
  haloGrad.addColorStop(0, 'rgba(220,232,255,0.28)');
  haloGrad.addColorStop(0.4, 'rgba(220,232,255,0.07)');
  haloGrad.addColorStop(1, 'rgba(220,232,255,0)');
  sctx.fillStyle = haloGrad;
  sctx.fillRect(mx - mr * 4.2, my - mr * 4.2, mr * 8.4, mr * 8.4);
  sctx.strokeStyle = 'rgba(220,232,255,0.14)';
  sctx.lineWidth = 1.5;
  sctx.beginPath();
  sctx.arc(mx, my, mr * 2.1, 0, Math.PI * 2);
  sctx.stroke();
  sctx.fillStyle = moonlight;
  sctx.beginPath();
  sctx.arc(mx, my, mr, 0, Math.PI * 2);
  sctx.fill();
  sctx.fillStyle = 'rgba(150,168,205,0.5)';
  const craters: Array<[number, number, number]> = [
    [-0.3, -0.2, 0.22],
    [0.25, 0.1, 0.16],
    [-0.05, 0.38, 0.13],
    [0.38, -0.34, 0.1],
  ];
  for (const [cx, cy, cr] of craters) {
    sctx.beginPath();
    sctx.arc(mx + cx * mr, my + cy * mr, cr * mr, 0, Math.PI * 2);
    sctx.fill();
  }

  // nubes nocturnas: masas oscuras con el borde lunar iluminado
  const cloudDark = mix(skyTop, '#060810', 0.45);
  const cloudLit = mix(skyTop, moonlight, 0.4);
  for (let c = 0; c < 4; c++) {
    const cx = viewW * (0.12 + 0.76 * ((c * 0.618034 + 0.2) % 1));
    const cy = H * (0.12 + 0.2 * rnd());
    const cw = viewW * (0.1 + rnd() * 0.12);
    for (let b = 0; b < 6; b++) {
      const bx = cx + (rnd() - 0.5) * cw;
      const by = cy + (rnd() - 0.5) * cw * 0.18;
      const br = cw * (0.14 + rnd() * 0.14);
      sctx.fillStyle = cloudLit;
      sctx.globalAlpha = 0.3;
      sctx.beginPath();
      sctx.ellipse(bx, by - 2.5, br, br * 0.42, 0, 0, Math.PI * 2);
      sctx.fill();
      sctx.fillStyle = cloudDark;
      sctx.globalAlpha = 0.75;
      sctx.beginPath();
      sctx.ellipse(bx, by, br, br * 0.4, 0, 0, Math.PI * 2);
      sctx.fill();
    }
  }
  sctx.globalAlpha = 1;

  // --- montañas lejanas: casi del color del cielo, con bruma en la base ---
  const farW = planeW(PARALLAX.far);
  const [far, fctx] = makeLayer(farW, H);
  const farColor = mix(saturate(shade(palette[0].hex, 0.45), 1.4), skyTop, 0.5);
  const farYs = silhouette(fctx, farW, H, seed + 7, H * 0.9, H * 0.42, farColor);
  // borde lunar en las cumbres lejanas
  fctx.strokeStyle = 'rgba(220,232,255,0.14)';
  fctx.lineWidth = 1.4;
  fctx.beginPath();
  for (let c = 0; c <= 220; c++) {
    const x = (c / 220) * farW;
    if (c === 0) fctx.moveTo(x, farYs[c]);
    else fctx.lineTo(x, farYs[c]);
  }
  fctx.stroke();
  const haze = fctx.createLinearGradient(0, H * 0.55, 0, H);
  haze.addColorStop(0, 'rgba(10,13,28,0)');
  haze.addColorStop(1, 'rgba(10,13,28,0.55)');
  fctx.fillStyle = haze;
  fctx.fillRect(0, 0, farW, H);

  // --- colinas medias + el castillo de la Pinacoteca en su cima ---
  const midW = planeW(PARALLAX.mid);
  const [mid, mctx] = makeLayer(midW, H);
  const midColor = mix(
    saturate(shade(palette[Math.min(2, palette.length - 1)].hex, 0.4), 1.35),
    skyBottom,
    0.3,
  );
  const midYs = silhouette(mctx, midW, H, seed + 13, H * 0.99, H * 0.34, midColor);
  // bosque de silueta sobre las colinas: copas oscuras a contraluz
  const canopy = shade(midColor, 0.72);
  let ch = (seed ^ 0x5d) >>> 0 || 17;
  const crnd = () => {
    ch = (ch * 16807) % 2147483647;
    return ch / 2147483647;
  };
  for (let t = 0; t < 26; t++) {
    const col = Math.floor(crnd() * 220);
    const x = (col / 220) * midW;
    const y = midYs[col];
    const r = 7 + crnd() * 12;
    mctx.fillStyle = canopy;
    mctx.beginPath();
    mctx.arc(x, y - r * 0.5, r, 0, Math.PI * 2);
    mctx.arc(x - r * 0.7, y - r * 0.2, r * 0.7, 0, Math.PI * 2);
    mctx.arc(x + r * 0.7, y - r * 0.25, r * 0.75, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillRect(x - 1.2, y - r * 0.4, 2.4, r * 0.9);
  }
  // el castillo, en la colina de la sección áurea, con ventanas cálidas
  const castleCol = Math.floor(220 * 0.618);
  castle(
    mctx,
    (castleCol / 220) * midW,
    midYs[castleCol] + 6,
    H * 0.21,
    shade(midColor, 0.62),
    warm,
  );

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

  // --- viñeta nocturna: los bordes se hunden en la noche ---
  const [vignette, vctx] = makeLayer(viewW, H);
  const vg = vctx.createRadialGradient(
    viewW / 2,
    H * 0.42,
    Math.min(viewW, H) * 0.42,
    viewW / 2,
    H * 0.5,
    Math.max(viewW, H) * 0.72,
  );
  vg.addColorStop(0, 'rgba(6,8,18,0)');
  vg.addColorStop(1, 'rgba(6,8,18,0.5)');
  vctx.fillStyle = vg;
  vctx.fillRect(0, 0, viewW, H);

  return { sky, far, mid, fore, vignette };
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

  // árboles de ramificación áurea con follaje de verdad: masas de copas en
  // tres tonos del color del cuadro, iluminadas por la luna desde arriba
  for (let t = 0; t < 8; t++) {
    const x = worldW * (0.04 + 0.92 * ((t * 0.618034 + 0.31) % 1));
    const size = 38 + rnd() * 46;
    const base = saturate(palette[Math.floor(rnd() * palette.length)].hex, 1.4);
    branch(ctx, x, floorY + 4, Math.PI / 2 + (rnd() - 0.5) * 0.3, size, 4.5, 6, base, trunk);
    // masas de follaje sobre el esqueleto de ramas
    const crownY = floorY - size * 1.55;
    const tones = [shade(base, 0.5), shade(base, 0.8), saturate(base, 1.1, 0.1)];
    for (let m = 0; m < 11; m++) {
      const a = rnd() * Math.PI * 2;
      const rr = size * (0.2 + rnd() * 0.42);
      const bx = x + Math.cos(a) * rr * 1.15;
      const by = crownY + Math.sin(a) * rr * 0.66;
      const br = size * (0.16 + rnd() * 0.16);
      // tono según altura: lo alto recibe luna, lo bajo queda en sombra
      const tone = by < crownY - size * 0.12 ? 2 : by > crownY + size * 0.14 ? 0 : 1;
      ctx.fillStyle = tones[tone];
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
