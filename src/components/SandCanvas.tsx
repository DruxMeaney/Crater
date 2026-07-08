import { useEffect, useRef } from 'react';
import { shade } from '../lib/color';
import type { CraterAudio } from '../lib/audio';
import type { AnalyzedImage, Phase } from '../lib/types';

interface Props {
  analyzed: AnalyzedImage;
  audio: CraterAudio;
  phase: Phase;
  releaseOrder: number[]; // índices de paleta en orden de derrumbe
  onGroupRelease: (paletteIndex: number) => void;
  onCollapseDone: () => void;
  onReformDone: () => void;
}

const TARGET_GRAINS = 12000;
const GRAVITY = 1150; // px/s²
const GROUP_STAGGER = 1.15; // s entre grupos
const GRAIN_STAGGER = 1.0; // s de dispersión dentro de un grupo
const REFORM_TIME = 1.3; // s

// estados de grano
const INTACT = 0;
const FALLING = 1;
const SETTLED = 2;

interface Sim {
  n: number;
  u: Float32Array; // posición original normalizada en la imagen
  v: Float32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  delay: Float32Array; // retardo de caída dentro del grupo
  phase01: Float32Array; // fase para el vaivén
  group: Uint8Array;
  shadeIdx: Uint8Array; // 0 oscuro, 1 base, 2 claro
  state: Uint8Array;
  buckets: number[][][]; // [grupo][sombra] -> índices de granos
  pileH: Float32Array;
  numCols: number;
  grainSize: number;
  cssW: number;
  cssH: number;
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
  floorY: number;
  releaseAt: Float32Array; // tiempo (s de sim) en que se suelta cada grupo
  released: Uint8Array;
  reformFrom: { x: Float32Array; y: Float32Array } | null;
  clock: number; // reloj de simulación en s (avanza solo en collapse/reform)
  flash: Float32Array; // brillo por grupo al disparar nota
  styles: string[][]; // [grupo][sombra + flash]
}

export function SandCanvas({
  analyzed,
  audio,
  phase,
  releaseOrder,
  onGroupRelease,
  onCollapseDone,
  onReformDone,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const callbacksRef = useRef({ onGroupRelease, onCollapseDone, onReformDone });
  callbacksRef.current = { onGroupRelease, onCollapseDone, onReformDone };

  // --- inicialización de granos al cambiar la imagen ---
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const buildSim = (): Sim | null => {
      const rect = wrap.getBoundingClientRect();
      const W = Math.max(200, rect.width);
      const H = Math.max(200, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { width: iw, height: ih, pixels, groups, palette } = analyzed;
      // paso de muestreo para ~TARGET_GRAINS granos
      const totalPx = iw * ih;
      const stride = Math.max(1, Math.round(Math.sqrt(totalPx / TARGET_GRAINS)));

      // recolectar granos
      const gu: number[] = [];
      const gv: number[] = [];
      const gg: number[] = [];
      const gs: number[] = [];
      // con stride entero el conteo puede excederse mucho: descartar el sobrante
      const estimate = Math.ceil(iw / stride) * Math.ceil(ih / stride);
      const keepRatio = Math.min(1, (TARGET_GRAINS * 1.1) / estimate);
      let hash = 0;
      for (let y = 0; y < ih; y += stride) {
        for (let x = 0; x < iw; x += stride) {
          hash = (hash * 1103515245 + 12345) & 0x7fffffff;
          if (keepRatio < 1 && hash / 0x7fffffff > keepRatio) continue;
          const idx = y * iw + x;
          const g = groups[idx];
          if (g === -1) continue;
          gu.push((x + 0.5) / iw);
          gv.push((y + 0.5) / ih);
          gg.push(g);
          // sombra según luminancia real del píxel vs la del color de paleta
          const lum = 0.299 * pixels[idx * 4] + 0.587 * pixels[idx * 4 + 1] + 0.114 * pixels[idx * 4 + 2];
          const pal = palette[g];
          const palLum = 0.299 * pal.r + 0.587 * pal.g + 0.114 * pal.b;
          gs.push(lum < palLum - 14 ? 0 : lum > palLum + 14 ? 2 : 1);
        }
      }
      const n = gu.length;
      if (n === 0) return null;

      // layout: imagen centrada en el 66% superior
      const areaH = H * 0.66;
      const margin = 24;
      const scale = Math.min((W - margin * 2) / iw, (areaH - margin * 2) / ih);
      const imgW = iw * scale;
      const imgH = ih * scale;
      const imgX = (W - imgW) / 2;
      const imgY = margin + (areaH - margin * 2 - imgH) / 2;

      const grainSize = Math.max(2, Math.min(4, Math.round(scale * Math.max(1, stride) * 0.9)));
      const floorY = H - 6;
      const numCols = Math.ceil(W / grainSize);

      const sim: Sim = {
        n,
        u: new Float32Array(gu),
        v: new Float32Array(gv),
        x: new Float32Array(n),
        y: new Float32Array(n),
        vx: new Float32Array(n),
        vy: new Float32Array(n),
        delay: new Float32Array(n),
        phase01: new Float32Array(n),
        group: new Uint8Array(gg),
        shadeIdx: new Uint8Array(gs),
        state: new Uint8Array(n),
        buckets: [],
        pileH: new Float32Array(numCols),
        numCols,
        grainSize,
        cssW: W,
        cssH: H,
        imgX,
        imgY,
        imgW,
        imgH,
        floorY,
        releaseAt: new Float32Array(palette.length).fill(Infinity),
        released: new Uint8Array(palette.length),
        reformFrom: null,
        clock: 0,
        flash: new Float32Array(palette.length),
        styles: palette.map((p) => [
          shade(p.hex, 0.72),
          p.hex,
          shade(p.hex, 1.22),
          shade(p.hex, 1.6), // flash
        ]),
      };

      // posiciones iniciales + delays pseudoaleatorios deterministas
      for (let i = 0; i < n; i++) {
        sim.x[i] = imgX + sim.u[i] * imgW;
        sim.y[i] = imgY + sim.v[i] * imgH;
        const r = fract(Math.sin(i * 127.1) * 43758.5453);
        sim.delay[i] = r * GRAIN_STAGGER + sim.u[i] * 0.35;
        sim.phase01[i] = fract(Math.sin(i * 311.7) * 12543.21);
      }

      // buckets por (grupo, sombra) para pintar con pocos cambios de fillStyle
      sim.buckets = palette.map(() => [[], [], []]);
      for (let i = 0; i < n; i++) sim.buckets[sim.group[i]][sim.shadeIdx[i]].push(i);

      return sim;
    };

    simRef.current = buildSim();
    // si la imagen cambia estando derrumbada, el nuevo sim arranca intacto:
    // App resetea la fase a 'intact' al cambiar de imagen.

    const observer = new ResizeObserver(() => {
      const prev = simRef.current;
      const next = buildSim();
      if (!next || !prev) {
        simRef.current = next;
        return;
      }
      // conservar el estado visual actual tras el resize
      next.releaseAt.set(prev.releaseAt);
      next.released.set(prev.released);
      next.clock = prev.clock;
      if (phaseRef.current === 'collapsed' || phaseRef.current === 'collapsing') {
        if (next.n === prev.n) resettleFrom(prev, next);
        else settleInstant(next);
      }
      // durante 'reforming', next.reformFrom queda null y stepReform
      // completará la reforma de inmediato (los granos ya están en su sitio)
      simRef.current = next;
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [analyzed]);

  // --- transiciones de fase ---
  useEffect(() => {
    const sim = simRef.current;
    const prev = phaseRef.current;
    phaseRef.current = phase;
    if (!sim) return;

    if (phase === 'collapsing' && prev !== 'collapsing') {
      sim.clock = 0;
      sim.released.fill(0);
      sim.pileH.fill(0);
      for (let i = 0; i < sim.n; i++) {
        sim.state[i] = INTACT;
        sim.x[i] = sim.imgX + sim.u[i] * sim.imgW;
        sim.y[i] = sim.imgY + sim.v[i] * sim.imgH;
      }
      releaseOrder.forEach((paletteIdx, orderIdx) => {
        sim.releaseAt[paletteIdx] = 0.35 + orderIdx * GROUP_STAGGER;
      });
    }

    if (phase === 'reforming' && prev !== 'reforming') {
      sim.clock = 0;
      sim.reformFrom = { x: Float32Array.from(sim.x), y: Float32Array.from(sim.y) };
      sim.releaseAt.fill(Infinity);
      sim.released.fill(0);
      sim.pileH.fill(0);
    }
  }, [phase, releaseOrder]);

  // --- parpadeo al disparar notas ---
  useEffect(() => {
    return audio.onTrigger((trackId) => {
      const sim = simRef.current;
      if (sim && trackId < sim.flash.length) sim.flash[trackId] = 1;
    });
  }, [audio]);

  // --- bucle de animación ---
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sim = simRef.current;
      const canvas = canvasRef.current;
      if (!sim || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ph = phaseRef.current;
      if (ph === 'collapsing') stepCollapse(sim, dt, callbacksRef.current);
      else if (ph === 'reforming') stepReform(sim, dt, callbacksRef.current);

      for (let g = 0; g < sim.flash.length; g++) sim.flash[g] *= 0.9;

      draw(ctx, sim);
    };
    raf = requestAnimationFrame(tick);

    if (import.meta.env.DEV) {
      // avance manual de la simulación para entornos sin rAF (tests headless)
      (window as unknown as Record<string, unknown>).__craterTick = (frames: number, dt = 1 / 60) => {
        const sim = simRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!sim || !canvas || !ctx) return null;
        for (let f = 0; f < frames; f++) {
          const ph = phaseRef.current;
          if (ph === 'collapsing') stepCollapse(sim, dt, callbacksRef.current);
          else if (ph === 'reforming') stepReform(sim, dt, callbacksRef.current);
          for (let g = 0; g < sim.flash.length; g++) sim.flash[g] *= 0.9;
        }
        draw(ctx, sim);
        return {
          ph: phaseRef.current,
          clock: sim.clock,
          released: Array.from(sim.released),
          falling: sim.state.filter((s) => s === 1).length,
          settled: sim.state.filter((s) => s === 2).length,
          intact: sim.state.filter((s) => s === 0).length,
        };
      };
    }

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="sand-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function fract(v: number): number {
  return v - Math.floor(v);
}

function stepCollapse(
  sim: Sim,
  dt: number,
  cb: { onGroupRelease: (i: number) => void; onCollapseDone: () => void },
): void {
  sim.clock += dt;

  // avisar cuándo se suelta cada grupo (para el fade-in de su pista)
  for (let g = 0; g < sim.releaseAt.length; g++) {
    if (!sim.released[g] && sim.clock >= sim.releaseAt[g]) {
      sim.released[g] = 1;
      cb.onGroupRelease(g);
    }
  }

  let allSettled = true;
  for (let i = 0; i < sim.n; i++) {
    const st = sim.state[i];
    if (st === SETTLED) continue;
    const g = sim.group[i];
    if (st === INTACT) {
      if (sim.released[g] && sim.clock >= sim.releaseAt[g] + sim.delay[i]) {
        sim.state[i] = FALLING;
        sim.vx[i] = (sim.phase01[i] - 0.5) * 130;
        sim.vy[i] = -40 - sim.phase01[i] * 60;
      } else {
        allSettled = false;
        continue;
      }
    }
    // FALLING
    allSettled = false;
    sim.vy[i] += GRAVITY * dt;
    sim.vx[i] += Math.sin(sim.clock * 2.4 + sim.phase01[i] * 6.28) * 26 * dt;
    sim.vx[i] *= 1 - 0.6 * dt;
    let nx = sim.x[i] + sim.vx[i] * dt;
    const ny = sim.y[i] + sim.vy[i] * dt;
    if (nx < 2) nx = 2;
    if (nx > sim.numCols * sim.grainSize - 2) nx = sim.numCols * sim.grainSize - 2;

    let col = Math.min(sim.numCols - 1, Math.max(0, Math.floor(nx / sim.grainSize)));
    const groundY = sim.floorY - sim.pileH[col];
    if (ny >= groundY) {
      col = rollTo(sim, col);
      sim.state[i] = SETTLED;
      sim.pileH[col] += sim.grainSize * 0.82;
      sim.x[i] = col * sim.grainSize + (sim.phase01[i] - 0.5) * sim.grainSize * 0.6;
      sim.y[i] = sim.floorY - sim.pileH[col];
      sim.vx[i] = 0;
      sim.vy[i] = 0;
    } else {
      sim.x[i] = nx;
      sim.y[i] = ny;
    }
  }

  if (allSettled && sim.released.every((r) => r === 1)) {
    cb.onCollapseDone();
  }
}

// un grano rueda hacia el vecino más bajo si la pila local es muy empinada
function rollTo(sim: Sim, col: number): number {
  let c = col;
  for (let iter = 0; iter < 7; iter++) {
    const here = sim.pileH[c];
    const left = c > 0 ? sim.pileH[c - 1] : Infinity;
    const right = c < sim.numCols - 1 ? sim.pileH[c + 1] : Infinity;
    const threshold = sim.grainSize * 2.2;
    if (left < here - threshold && left <= right) c -= 1;
    else if (right < here - threshold) c += 1;
    else break;
  }
  return c;
}

function stepReform(sim: Sim, dt: number, cb: { onReformDone: () => void }): void {
  sim.clock += dt;
  const from = sim.reformFrom;
  if (!from) {
    // sin origen (p.ej. resize en plena reforma): completar de inmediato
    for (let i = 0; i < sim.n; i++) sim.state[i] = INTACT;
    cb.onReformDone();
    return;
  }
  const t = Math.min(1, sim.clock / REFORM_TIME);
  const ease = 1 - Math.pow(1 - t, 3);
  for (let i = 0; i < sim.n; i++) {
    const tx = sim.imgX + sim.u[i] * sim.imgW;
    const ty = sim.imgY + sim.v[i] * sim.imgH;
    sim.x[i] = from.x[i] + (tx - from.x[i]) * ease;
    sim.y[i] = from.y[i] + (ty - from.y[i]) * ease;
  }
  if (t >= 1) {
    for (let i = 0; i < sim.n; i++) sim.state[i] = INTACT;
    sim.reformFrom = null;
    cb.onReformDone();
  }
}

// tras un resize en pleno derrumbe: conserva el estado por grano del sim anterior,
// reasentando los asentados y reescalando los que están cayendo
function resettleFrom(prev: Sim, next: Sim): void {
  next.pileH.fill(0);
  const sx = next.cssW / Math.max(1, prev.cssW);
  const sy = next.cssH / Math.max(1, prev.cssH);
  for (let i = 0; i < next.n; i++) {
    const st = prev.state[i];
    next.state[i] = st;
    if (st === SETTLED) {
      let col = Math.min(
        next.numCols - 1,
        Math.max(0, Math.floor((prev.x[i] * sx) / next.grainSize)),
      );
      col = rollTo(next, col);
      next.pileH[col] += next.grainSize * 0.82;
      next.x[i] = col * next.grainSize;
      next.y[i] = next.floorY - next.pileH[col];
    } else if (st === FALLING) {
      next.x[i] = prev.x[i] * sx;
      next.y[i] = Math.min(prev.y[i] * sy, next.floorY - 1);
      next.vx[i] = prev.vx[i];
      next.vy[i] = prev.vy[i];
    }
    // INTACT: buildSim ya lo colocó en su posición dentro de la imagen
  }
}

// coloca todos los granos ya asentados sobre pilas (tras un resize)
function settleInstant(sim: Sim): void {
  sim.pileH.fill(0);
  for (let i = 0; i < sim.n; i++) {
    let col = Math.min(
      sim.numCols - 1,
      Math.max(0, Math.floor((sim.imgX + sim.u[i] * sim.imgW) / sim.grainSize)),
    );
    col = rollTo(sim, col);
    sim.state[i] = SETTLED;
    sim.pileH[col] += sim.grainSize * 0.82;
    sim.x[i] = col * sim.grainSize;
    sim.y[i] = sim.floorY - sim.pileH[col];
  }
}

function draw(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const W = sim.cssW;
  const H = sim.cssH;
  ctx.clearRect(0, 0, W, H);

  // suelo sutil
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, sim.floorY + sim.grainSize, W, 1);

  const gs = sim.grainSize;
  for (let g = 0; g < sim.buckets.length; g++) {
    const flashing = sim.flash[g] > 0.25;
    for (let s = 0; s < 3; s++) {
      const bucket = sim.buckets[g][s];
      if (bucket.length === 0) continue;
      ctx.fillStyle = flashing ? sim.styles[g][3] : sim.styles[g][s];
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        ctx.fillRect(sim.x[i], sim.y[i], gs, gs);
      }
    }
  }
}
