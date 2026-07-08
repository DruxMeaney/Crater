import { useEffect, useRef } from 'react';
import { shade } from '../lib/color';
import { fibonacciProfile, scaleProfileToArea, GOLDEN_SECTIONS } from '../lib/terrain';
import { buildSprite, SPRITE_W, SPRITE_H, type Character, type SpriteSet } from '../lib/sprites';
import type { CraterAudio } from '../lib/audio';
import type { AnalyzedImage, Phase } from '../lib/types';

interface Props {
  analyzed: AnalyzedImage;
  audio: CraterAudio;
  phase: Phase;
  walkMode: boolean; // modo caminata: el custodio recorre las dunas
  character: Character;
  releaseOrder: number[]; // índices de paleta en orden de derrumbe
  onGroupRelease: (paletteIndex: number) => void;
  onCollapseDone: () => void;
  onReformDone: () => void;
  onEcoProgress: (collected: number, total: number) => void;
  onWin: () => void;
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
const RETURNING = 3; // vuela de vuelta a la imagen (eco recogido)

const WALK_SPEED = 150; // px/s
const STEP_EVERY = 30; // px caminados entre pasos sonoros
const ECO_RADIUS = 18; // px para recoger un eco

interface Eco {
  u: number; // posición horizontal normalizada (columna pico de su color)
  group: number;
  collected: boolean;
  x: number;
  y: number;
}

interface Player {
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  stepDist: number;
  bob: number;
  walkPhase: number; // anima las piernitas
  trail: Array<{ x: number; y: number; age: number }>;
}

// estado del juego dentro del nivel
interface GameState {
  orbs: number;
  magic: number; // 0..100
  hp: number; // 0..100 (decorativa en el nivel 1)
  casting: number; // segundos restantes del hechizo (0 = inactivo)
  castDone: boolean;
  ghost: HTMLCanvasElement | null; // arena de ceniza: la huella de las dunas
}

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
  // modo caminata
  player: Player;
  ecos: Eco[];
  rx: Float32Array; // origen del vuelo de retorno por grano
  ry: Float32Array;
  returnT: Float32Array;
  walkClock: number;
  targetH: Float32Array; // perfil Fibonacci que la arena debe rellenar
  game: GameState;
}

export function SandCanvas({
  analyzed,
  audio,
  phase,
  walkMode,
  character,
  releaseOrder,
  onGroupRelease,
  onCollapseDone,
  onReformDone,
  onEcoProgress,
  onWin,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const walkRef = useRef(walkMode);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const keysRef = useRef({ left: false, right: false, cast: false });
  const spriteRef = useRef<SpriteSet | null>(null);

  useEffect(() => {
    spriteRef.current = buildSprite(character);
  }, [character]);
  const callbacksRef = useRef({ onGroupRelease, onCollapseDone, onReformDone, onEcoProgress, onWin });
  callbacksRef.current = { onGroupRelease, onCollapseDone, onReformDone, onEcoProgress, onWin };

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

      // orbes de canto: tres, en las secciones áureas del mapa (1/φ³, 1/φ², 1/φ),
      // asignados a los tres colores de mayor cobertura
      const orbCount = Math.min(3, palette.length);
      const ecos: Eco[] = GOLDEN_SECTIONS.slice(0, orbCount).map((u, g) => ({
        u,
        group: g,
        collected: false,
        x: W * (0.05 + 0.9 * u),
        y: floorY - 20,
      }));

      // perfil Fibonacci: la arena disponible rellenará esta silueta
      // (cada grano asentado suma grainSize*0.82 px a la altura de su columna)
      const targetH = scaleProfileToArea(fibonacciProfile(numCols, n), n * grainSize * 0.82);

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
        player: {
          x: W * 0.12,
          y: floorY - 20,
          dir: 1,
          moving: false,
          stepDist: 0,
          bob: 0,
          walkPhase: 0,
          trail: [],
        },
        ecos,
        rx: new Float32Array(n),
        ry: new Float32Array(n),
        returnT: new Float32Array(n),
        walkClock: 0,
        targetH,
        game: { orbs: 0, magic: 0, hp: 100, casting: 0, castDone: false, ghost: null },
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
      next.walkClock = prev.walkClock;
      next.player = {
        ...prev.player,
        x: prev.player.x * (next.cssW / Math.max(1, prev.cssW)),
        trail: [],
      };
      next.ecos.forEach((e, i) => (e.collected = prev.ecos[i]?.collected ?? false));
      next.game = { ...prev.game };
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

  // --- modo caminata: entrada/salida y teclado ---
  useEffect(() => {
    walkRef.current = walkMode;
    const sim = simRef.current;
    if (walkMode && sim) {
      sim.player.x = sim.cssW * 0.12;
      sim.player.trail = [];
      callbacksRef.current.onEcoProgress(sim.game.orbs, sim.ecos.length);
    }
    if (!walkMode) {
      keysRef.current.left = false;
      keysRef.current.right = false;
      keysRef.current.cast = false;
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keysRef.current.left = true;
        e.preventDefault();
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keysRef.current.right = true;
        e.preventDefault();
      }
      if (e.code === 'KeyE') {
        keysRef.current.cast = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keysRef.current.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') keysRef.current.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [walkMode]);

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
      else if (ph === 'collapsed') {
        sim.walkClock += dt;
        stepReturning(sim, dt);
        if (walkRef.current) {
          stepWalk(sim, dt, keysRef.current, audioRef.current, callbacksRef.current);
        }
      }

      for (let g = 0; g < sim.flash.length; g++) sim.flash[g] *= 0.9;

      draw(ctx, sim, walkRef.current, spriteRef.current);
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
          else if (ph === 'collapsed') {
            sim.walkClock += dt;
            stepReturning(sim, dt);
            if (walkRef.current) {
              stepWalk(sim, dt, keysRef.current, audioRef.current, callbacksRef.current);
            }
          }
          for (let g = 0; g < sim.flash.length; g++) sim.flash[g] *= 0.9;
        }
        draw(ctx, sim, walkRef.current, spriteRef.current);
        return {
          ph: phaseRef.current,
          clock: sim.clock,
          released: Array.from(sim.released),
          falling: sim.state.filter((s) => s === 1).length,
          settled: sim.state.filter((s) => s === 2).length,
          intact: sim.state.filter((s) => s === 0).length,
          returning: sim.state.filter((s) => s === 3).length,
          walk: walkRef.current,
          player: { x: sim.player.x, y: sim.player.y },
          ecos: sim.ecos.map((e) => ({ x: Math.round(e.x), collected: e.collected })),
          game: { ...sim.game, ghost: sim.game.ghost !== null },
        };
      };
      (window as unknown as Record<string, unknown>).__craterTeleport = (x: number) => {
        const sim = simRef.current;
        if (sim) sim.player.x = x;
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
      col = seekDeficit(sim, col);
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

// la arena obedece a la ecuación: el grano busca la columna cercana donde el
// perfil Fibonacci aún tiene hambre (mayor déficit entre objetivo y pila real)
function seekDeficit(sim: Sim, col: number): number {
  const RANGE = 26;
  let best = col;
  let bestDeficit = sim.targetH[col] - sim.pileH[col];
  for (let d = 1; d <= RANGE; d++) {
    const l = col - d;
    const r = col + d;
    if (l >= 0) {
      const def = sim.targetH[l] - sim.pileH[l] - d * 0.35; // la distancia penaliza
      if (def > bestDeficit) {
        bestDeficit = def;
        best = l;
      }
    }
    if (r < sim.numCols) {
      const def = sim.targetH[r] - sim.pileH[r] - d * 0.35;
      if (def > bestDeficit) {
        bestDeficit = def;
        best = r;
      }
    }
  }
  return best;
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

// altura de la pila bajo x, suavizada con los vecinos
function groundHeightAt(sim: Sim, x: number): number {
  const col = Math.min(sim.numCols - 1, Math.max(0, Math.floor(x / sim.grainSize)));
  const a = sim.pileH[Math.max(0, col - 1)];
  const b = sim.pileH[col];
  const c = sim.pileH[Math.min(sim.numCols - 1, col + 1)];
  return (a + b + c) / 3;
}

const CAST_TIME = 3.4; // duración del hechizo de reconstrucción

function stepWalk(
  sim: Sim,
  dt: number,
  keys: { left: boolean; right: boolean; cast: boolean },
  audio: { playStep: (h: number) => void; playEco: (g: number) => void; playCast: () => void },
  cb: { onEcoProgress: (c: number, t: number) => void; onWin: () => void },
): void {
  const p = sim.player;
  const g = sim.game;
  const vx = (keys.right ? WALK_SPEED : 0) - (keys.left ? WALK_SPEED : 0);
  p.moving = vx !== 0;
  if (p.moving) {
    p.dir = vx > 0 ? 1 : -1;
    p.x = Math.max(10, Math.min(sim.cssW - 10, p.x + vx * dt));
    p.bob += dt * 11;
    p.walkPhase += dt * 7;
    p.stepDist += Math.abs(vx) * dt;
  }

  const h = groundHeightAt(sim, p.x);
  const targetY = sim.floorY - h - 7;
  p.y += (targetY - p.y) * Math.min(1, 14 * dt);

  if (p.stepDist >= STEP_EVERY) {
    p.stepDist = 0;
    let maxPile = 1;
    for (let c = 0; c < sim.numCols; c++) if (sim.pileH[c] > maxPile) maxPile = sim.pileH[c];
    audio.playStep(h / maxPile);
    p.trail.push({ x: p.x, y: p.y + 5, age: 0 });
    if (p.trail.length > 7) p.trail.shift();
  }
  for (const t of p.trail) t.age += dt;

  // recoger orbes de canto (solo caminando): cargan la magia, no reconstruyen aún
  for (const eco of sim.ecos) {
    eco.y = sim.floorY - groundHeightAt(sim, eco.x) - 14;
    if (eco.collected || !p.moving || Math.abs(p.x - eco.x) > ECO_RADIUS) continue;
    eco.collected = true;
    audio.playEco(eco.group);
    g.orbs++;
    g.magic = Math.min(100, g.magic + Math.ceil(100 / sim.ecos.length));
    cb.onEcoProgress(g.orbs, sim.ecos.length);
  }

  // hechizo de reconstrucción: E con todos los orbes y la magia llena
  const wantsCast = keys.cast;
  keys.cast = false;
  if (
    wantsCast &&
    g.casting === 0 &&
    !g.castDone &&
    g.ghost === null &&
    g.orbs >= sim.ecos.length &&
    g.magic >= 99
  ) {
    beginCast(sim, audio);
  }

  if (g.casting > 0) {
    g.casting = Math.max(0, g.casting - dt);
    g.magic = Math.max(0, 100 * (g.casting / CAST_TIME));
  }
  if (g.ghost !== null && g.casting === 0 && !g.castDone) {
    let returning = false;
    for (let i = 0; i < sim.n; i++) {
      if (sim.state[i] === RETURNING) {
        returning = true;
        break;
      }
    }
    if (!returning) {
      g.castDone = true;
      cb.onWin();
    }
  }
}

function beginCast(sim: Sim, audio: { playCast: () => void }): void {
  const g = sim.game;
  g.casting = CAST_TIME;
  audio.playCast();

  // arena de ceniza: la huella gris de las dunas permanece cuando el color se va
  const ghost = document.createElement('canvas');
  ghost.width = Math.max(1, Math.round(sim.cssW));
  ghost.height = Math.max(1, Math.round(sim.cssH));
  const gtx = ghost.getContext('2d');
  if (gtx) {
    const ash = ['#2c313f', '#353b4b', '#40475a'];
    for (let i = 0; i < sim.n; i++) {
      if (sim.state[i] !== SETTLED) continue;
      gtx.fillStyle = ash[sim.shadeIdx[i]];
      gtx.fillRect(sim.x[i], sim.y[i], sim.grainSize, sim.grainSize);
    }
  }
  g.ghost = ghost;

  // toda la arena asentada despega en enjambre escalonado, color por color
  let k = 0;
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] !== SETTLED) continue;
    sim.state[i] = RETURNING;
    sim.rx[i] = sim.x[i];
    sim.ry[i] = sim.y[i];
    sim.returnT[i] = -(0.7 + sim.group[i] * 0.3 + (k % 130) * 0.011);
    k++;
  }
}

function stepReturning(sim: Sim, dt: number): void {
  for (let i = 0; i < sim.n; i++) {
    if (sim.state[i] !== RETURNING) continue;
    sim.returnT[i] += dt / 1.9;
    const t = sim.returnT[i];
    if (t <= 0) {
      // pre-vuelo: la arena tiembla, turbulenta, antes de despegar
      const j = sim.walkClock * 17 + sim.phase01[i] * 37;
      sim.x[i] = sim.rx[i] + Math.sin(j) * 2.6;
      sim.y[i] = sim.ry[i] + Math.cos(j * 1.3) * 1.8;
      continue;
    }
    const e = 1 - Math.pow(1 - Math.min(1, t), 3);
    const tx = sim.imgX + sim.u[i] * sim.imgW;
    const ty = sim.imgY + sim.v[i] * sim.imgH;
    const sway = Math.sin(t * 7 + sim.phase01[i] * 6.28) * 14 * (1 - e);
    sim.x[i] = sim.rx[i] + (tx - sim.rx[i]) * e + sway;
    sim.y[i] = sim.ry[i] + (ty - sim.ry[i]) * e;
    if (t >= 1) {
      sim.state[i] = INTACT;
      sim.x[i] = tx;
      sim.y[i] = ty;
    }
  }
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
    } else if (st === RETURNING) {
      next.rx[i] = prev.rx[i] * sx;
      next.ry[i] = prev.ry[i] * sy;
      next.returnT[i] = prev.returnT[i];
      next.x[i] = prev.x[i] * sx;
      next.y[i] = prev.y[i] * sy;
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

function draw(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  walkMode = false,
  sprite: SpriteSet | null = null,
): void {
  const W = sim.cssW;
  const H = sim.cssH;
  ctx.clearRect(0, 0, W, H);

  // suelo sutil
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, sim.floorY + sim.grainSize, W, 1);

  // arena de ceniza: la huella que dejaron las dunas tras el hechizo
  if (sim.game.ghost) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(sim.game.ghost, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

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

  if (!walkMode) return;

  // ecos sin recoger: diamante pulsante con haz de luz
  for (let e = 0; e < sim.ecos.length; e++) {
    const eco = sim.ecos[e];
    if (eco.collected) continue;
    const pulse = 0.55 + 0.35 * Math.sin(sim.walkClock * 3 + e * 1.7);
    ctx.fillStyle = 'rgba(156,232,216,0.07)';
    ctx.fillRect(eco.x - 2, sim.imgY, 4, Math.max(0, eco.y - sim.imgY));
    ctx.save();
    ctx.translate(eco.x, eco.y);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#9ce8d8';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // estela de pasos
  for (const t of sim.player.trail) {
    const a = Math.max(0, 0.5 - t.age * 0.25);
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#f6d9a8';
    ctx.fillRect(t.x - 1, t.y, 2, 2);
  }
  ctx.globalAlpha = 1;

  // el custodio: sprite pixel con piernitas animadas
  const p = sim.player;
  const bobY = p.moving ? Math.sin(p.bob) * 1.4 : 0;
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#f6d9a8';
  ctx.beginPath();
  ctx.arc(p.x, p.y + bobY - 8, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (sprite) {
    const scale = 2.6;
    const w = SPRITE_W * scale;
    const h = SPRITE_H * scale;
    const frame = p.moving ? 1 + (Math.floor(p.walkPhase * 2) % 2) : 0;
    ctx.save();
    ctx.translate(p.x, p.y + 9 + bobY);
    if (p.dir < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.frames[frame], -w / 2, -h, w, h);
    ctx.restore();
  }

  // hechizo en curso: turbulencia mágica
  const g = sim.game;
  if (g.casting > 0) {
    const prog = 1 - g.casting / CAST_TIME;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(156,232,216,${0.5 * (1 - prog)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 10, 20 + prog * W * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 36; k++) {
      const a = sim.walkClock * (1.5 + (k % 5) * 0.4) + k * 1.7;
      const r = 30 + ((k * 53) % Math.round(W * 0.45)) * prog;
      const sx = p.x + Math.cos(a) * r;
      const sy = p.y - 10 + Math.sin(a) * r * 0.5 - prog * 60;
      ctx.fillStyle = k % 3 === 0 ? 'rgba(246,217,168,0.7)' : 'rgba(156,232,216,0.6)';
      ctx.fillRect(sx, sy, 2.5, 2.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // HUD: vida, magia, orbes
  const bar = (y: number, value: number, color: string, label: string) => {
    ctx.fillStyle = 'rgba(216,220,232,0.7)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(label, 14, y + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(28, y, 110, 6);
    ctx.fillStyle = color;
    ctx.fillRect(28, y, 110 * (value / 100), 6);
  };
  bar(16, g.hp, '#e87c8c', '♥');
  bar(30, g.magic, '#9ce8d8', '✦');
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(216,220,232,0.8)';
  ctx.fillText(`orbes ${g.orbs}/${sim.ecos.length}`, 14, 58);
  if (g.castDone) {
    ctx.fillStyle = '#f6d9a8';
    ctx.fillText('canto restaurado ✦', 14, 76);
  } else if (g.ghost === null && g.orbs >= sim.ecos.length && g.magic >= 99) {
    const pulse = 0.55 + 0.45 * Math.sin(sim.walkClock * 4);
    ctx.fillStyle = `rgba(246,217,168,${pulse})`;
    ctx.fillText('E — hechizo de reconstrucción', 14, 76);
  } else if (sim.walkClock < 9) {
    ctx.fillStyle = 'rgba(216,220,232,0.45)';
    ctx.fillText('← → caminar', 14, 76);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(216,220,232,0.35)';
  ctx.fillText('nivel 1 · la espiral (fibonacci)', W - 14, 22);
  ctx.textAlign = 'left';
}
