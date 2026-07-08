import { rgbToHsl, rgbToHex } from './color';
import { mulberry32 } from './rng';
import type { AnalyzedImage, PaletteColor } from './types';

const ANALYSIS_MAX_SIDE = 300; // resolución para granos y patrones
const KMEANS_SAMPLE = 8000;
const K = 6;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export async function analyzeImage(src: string, seed: number): Promise<AnalyzedImage> {
  const img = await loadImage(src);
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, Math.round(img.naturalWidth * scale));
  const h = Math.max(8, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  // --- muestreo para k-means (ignora píxeles transparentes) ---
  const rng = mulberry32(seed);
  const opaque: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (pixels[i * 4 + 3] >= 128) opaque.push(i);
  }
  if (opaque.length < 16) throw new Error('La imagen es casi transparente: no hay píxeles que sonar');

  const sampleCount = Math.min(KMEANS_SAMPLE, opaque.length);
  const sample = new Float64Array(sampleCount * 3);
  for (let s = 0; s < sampleCount; s++) {
    const i = opaque[Math.floor(rng() * opaque.length)];
    sample[s * 3] = pixels[i * 4];
    sample[s * 3 + 1] = pixels[i * 4 + 1];
    sample[s * 3 + 2] = pixels[i * 4 + 2];
  }

  const centers = kmeans(sample, sampleCount, K, rng);

  // --- asignación de cada píxel a su color de paleta ---
  const groups = new Int16Array(w * h).fill(-1);
  const counts = new Array<number>(centers.length).fill(0);
  for (const i of opaque) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const dr = pixels[i * 4] - centers[c][0];
      const dg = pixels[i * 4 + 1] - centers[c][1];
      const db = pixels[i * 4 + 2] - centers[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    groups[i] = best;
    counts[best]++;
  }

  // --- construir paleta, descartar clusters con cobertura ínfima ---
  const total = opaque.length;
  const kept: number[] = [];
  for (let c = 0; c < centers.length; c++) {
    if (counts[c] / total >= 0.015) kept.push(c);
  }
  // orden por cobertura descendente
  kept.sort((a, b) => counts[b] - counts[a]);

  // reasignar píxeles de clusters descartados al más cercano de los conservados
  const remap = new Int16Array(centers.length).fill(-1);
  kept.forEach((c, newIdx) => (remap[c] = newIdx));
  for (const i of opaque) {
    const g = groups[i];
    if (remap[g] !== -1) {
      groups[i] = remap[g];
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    for (let kIdx = 0; kIdx < kept.length; kIdx++) {
      const c = kept[kIdx];
      const dr = pixels[i * 4] - centers[c][0];
      const dg = pixels[i * 4 + 1] - centers[c][1];
      const db = pixels[i * 4 + 2] - centers[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = kIdx;
      }
    }
    groups[i] = best;
  }

  const finalCounts = new Array<number>(kept.length).fill(0);
  for (const i of opaque) finalCounts[groups[i]]++;

  // reordenar por cobertura real (la reasignación pudo alterar el orden inicial)
  const order = kept.map((_, idx) => idx).sort((a, b) => finalCounts[b] - finalCounts[a]);
  const newIndex = new Int16Array(order.length);
  order.forEach((oldIdx, ni) => (newIndex[oldIdx] = ni));
  for (const i of opaque) groups[i] = newIndex[groups[i]];

  const palette: PaletteColor[] = order.map((oldIdx) => {
    const c = kept[oldIdx];
    const idx = oldIdx;
    const [r, g, b] = centers[c];
    const { h: hue, s, l } = rgbToHsl(r, g, b);
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
      hex: rgbToHex(r, g, b),
      hue,
      sat: s,
      light: l,
      coverage: finalCounts[idx] / total,
      code: `CRTR ${String(Math.round(hue)).padStart(3, '0')}-${Math.round(s * 9)}${Math.round(l * 9)}`,
    };
  });

  return { width: w, height: h, pixels, groups, palette };
}

function kmeans(
  sample: Float64Array,
  n: number,
  k: number,
  rng: () => number,
): Array<[number, number, number]> {
  // inicialización k-means++ simplificada
  const centers: Array<[number, number, number]> = [];
  const first = Math.floor(rng() * n);
  centers.push([sample[first * 3], sample[first * 3 + 1], sample[first * 3 + 2]]);
  while (centers.length < k) {
    let bestIdx = 0;
    let bestScore = -1;
    // elegimos entre 24 candidatos el más lejano a los centros existentes
    for (let t = 0; t < 24; t++) {
      const i = Math.floor(rng() * n);
      let minD = Infinity;
      for (const c of centers) {
        const dr = sample[i * 3] - c[0];
        const dg = sample[i * 3 + 1] - c[1];
        const db = sample[i * 3 + 2] - c[2];
        minD = Math.min(minD, dr * dr + dg * dg + db * db);
      }
      if (minD > bestScore) {
        bestScore = minD;
        bestIdx = i;
      }
    }
    centers.push([sample[bestIdx * 3], sample[bestIdx * 3 + 1], sample[bestIdx * 3 + 2]]);
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < 12; iter++) {
    // asignar
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dr = sample[i * 3] - centers[c][0];
        const dg = sample[i * 3 + 1] - centers[c][1];
        const db = sample[i * 3 + 2] - centers[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    // recalcular centros
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s[0] += sample[i * 3];
      s[1] += sample[i * 3 + 1];
      s[2] += sample[i * 3 + 2];
      s[3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }
  return centers;
}
