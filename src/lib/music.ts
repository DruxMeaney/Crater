import { mulberry32 } from './rng';
import {
  STEPS,
  STEPS_PER_BAR,
  ROLE_LABELS,
  type AnalyzedImage,
  type Composition,
  type Role,
  type Track,
} from './types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SOLFEGE = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

export const MODES: Record<string, number[]> = {
  lidio: [0, 2, 4, 6, 7, 9, 11],
  jónico: [0, 2, 4, 5, 7, 9, 11],
  mixolidio: [0, 2, 4, 5, 7, 9, 10],
  dórico: [0, 2, 3, 5, 7, 9, 10],
  eólico: [0, 2, 3, 5, 7, 8, 10],
  frigio: [0, 1, 3, 5, 7, 8, 10],
};
export const MODE_NAMES = Object.keys(MODES);

function midiToNote(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[pc] + String(Math.floor(midi / 12) - 1);
}

// nota MIDI de un grado diatónico (idx puede exceder 7 para subir de octava)
function diatonicMidi(rootPc: number, mode: number[], idx: number, baseOctave: number): number {
  const oct = Math.floor(idx / 7);
  const deg = ((idx % 7) + 7) % 7;
  return 12 * (baseOctave + 1) + rootPc + mode[deg] + 12 * oct;
}

function chordName(rootPc: number, mode: number[], deg: number): string {
  const root = mode[deg % 7];
  const third = (mode[(deg + 2) % 7] - root + 12) % 12;
  const fifth = (mode[(deg + 4) % 7] - root + 12) % 12;
  const seventh = (mode[(deg + 6) % 7] - root + 12) % 12;
  let quality: string;
  if (fifth === 6) quality = third === 3 ? 'm7♭5' : '7♭5';
  else if (third === 4) quality = seventh === 11 ? 'maj7' : '7';
  else quality = seventh === 10 ? 'm7' : 'm';
  return SOLFEGE[(rootPc + root) % 12] + quality;
}

interface ColumnStats {
  density: number[]; // por paso: fracción de píxeles de la columna que son de este grupo
  avgY: number[]; // por paso: altura promedio normalizada (0 arriba, 1 abajo)
}

function columnStats(img: AnalyzedImage, group: number): ColumnStats {
  const density = new Array<number>(STEPS).fill(0);
  const avgY = new Array<number>(STEPS).fill(0.5);
  const colTotal = new Array<number>(STEPS).fill(0);
  const colGroup = new Array<number>(STEPS).fill(0);
  const ySum = new Array<number>(STEPS).fill(0);

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const g = img.groups[y * img.width + x];
      if (g === -1) continue;
      const col = Math.min(STEPS - 1, Math.floor((x / img.width) * STEPS));
      colTotal[col]++;
      if (g === group) {
        colGroup[col]++;
        ySum[col] += y / img.height;
      }
    }
  }
  for (let c = 0; c < STEPS; c++) {
    density[c] = colTotal[c] > 0 ? colGroup[c] / colTotal[c] : 0;
    avgY[c] = colGroup[c] > 0 ? ySum[c] / colGroup[c] : 0.5;
  }
  return { density, avgY };
}

// elige las n columnas con mayor densidad (solo donde el color existe)
function chooseSteps(density: number[], n: number, rng: () => number, force0 = false): boolean[] {
  const steps = new Array<boolean>(STEPS).fill(false);
  const idx = density
    .map((d, i) => ({ d: d + rng() * 0.08, i })) // jitter: cada semilla elige columnas distintas
    .filter((e) => density[e.i] > 0.004)
    .sort((a, b) => b.d - a.d)
    .slice(0, n)
    .map((e) => e.i);
  for (const i of idx) steps[i] = true;
  if (force0 && idx.length > 0 && !steps[0]) {
    steps[idx[idx.length - 1]] = false;
    steps[0] = true;
  }
  return steps;
}

const ROLE_STEP_COUNT: Record<Role, number> = {
  pad: 4,
  bass: 6,
  arp: 12,
  pluck: 8,
  bell: 4,
  texture: 2,
};

// pool de tonos del acorde por rol: [octava base, cantidad de tonos]
const ROLE_POOL: Record<Role, [number, number]> = {
  pad: [3, 4],
  bass: [1, 2],
  arp: [4, 8],
  pluck: [3, 6],
  bell: [5, 5],
  texture: [4, 1],
};

export interface ComposeOverrides {
  rootPc?: number;
  modeName?: string;
}

export function compose(img: AnalyzedImage, seed: number, overrides: ComposeOverrides = {}): Composition {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const palette = img.palette;

  // --- carácter global de la imagen ---
  let warmth = 0;
  let brightness = 0;
  let satAvg = 0;
  for (const p of palette) {
    // colores casi grises no votan calidez: su matiz es ruido
    const isWarm = p.sat >= 0.08 && (p.hue < 70 || p.hue > 310) ? 1 : 0;
    warmth += isWarm * p.coverage * (0.3 + p.sat);
    brightness += p.light * p.coverage;
    satAvg += p.sat * p.coverage;
  }
  warmth = Math.min(1, warmth * 1.6);

  // raíz desde el matiz del color dominante; en imágenes grises, desde su luminosidad
  const dominant = palette[0];
  const rootPc =
    overrides.rootPc ??
    (dominant.sat < 0.08
      ? Math.round(dominant.light * 11) % 12
      : Math.round(dominant.hue / 30) % 12);

  // modo desde calidez × luminosidad: imágenes cálidas y brillantes → modos luminosos
  let modeName = overrides.modeName;
  if (!modeName) {
    if (warmth >= 0.45) modeName = brightness >= 0.6 ? 'lidio' : brightness >= 0.35 ? 'jónico' : 'mixolidio';
    else modeName = brightness >= 0.6 ? 'dórico' : brightness >= 0.35 ? 'eólico' : 'frigio';
  }
  const mode = MODES[modeName];

  const bpm = Math.round(56 + satAvg * 32 + (rng() * 8 - 4)); // ~52–92, territorio ambient

  // --- progresión: 4 acordes desde los 4 colores más presentes ---
  const rootHue = palette[0].hue;
  const degrees: number[] = [0];
  for (let i = 1; i < 4; i++) {
    const p = palette[Math.min(i, palette.length - 1)];
    const diff = (p.hue - rootHue + 360) % 360;
    let deg = Math.round(diff / (360 / 7)) % 7;
    if (deg === degrees[degrees.length - 1]) deg = (deg + 3) % 7; // evitar repetir acorde
    degrees.push(deg);
  }

  const chords = degrees.map((deg) => {
    const idxs = [deg, deg + 2, deg + 4, deg + 6];
    return idxs.map((idx) => midiToNote(diatonicMidi(rootPc, mode, idx, 3)));
  });
  const chordNames = degrees.map((deg) => chordName(rootPc, mode, deg));

  // --- asignación de roles por carácter del color ---
  const roles = assignRoles(palette);

  // --- pistas: patrón desde columnas de la imagen ---
  const tracks: Track[] = palette.map((color, pi) => {
    const role = roles[pi];
    const stats = columnStats(img, pi);
    // la cantidad de pasos también varía con la semilla (±30%)
    const stepCount = Math.max(2, Math.round(ROLE_STEP_COUNT[role] * (0.7 + rng() * 0.6)));
    const steps =
      role === 'pad' ? padSteps() : chooseSteps(stats.density, stepCount, rng, role === 'bass');

    const [baseOct, poolSize] = ROLE_POOL[role];
    const pitches = new Array<string>(STEPS).fill('');
    const velocities = new Array<number>(STEPS).fill(0);
    const maxDensity = Math.max(0.02, ...stats.density);

    for (let s = 0; s < STEPS; s++) {
      if (!steps[s]) continue;
      const bar = Math.floor(s / STEPS_PER_BAR);
      const deg = degrees[bar];
      // altura del color en esa columna → índice dentro del pool de tonos del acorde
      const heightNorm = 1 - stats.avgY[s]; // 1 = arriba de la imagen = agudo
      const poolIdx = Math.min(poolSize - 1, Math.round(heightNorm * (poolSize - 1)));
      const chordTones = [deg, deg + 2, deg + 4, deg + 6, deg + 7, deg + 9, deg + 11, deg + 13];
      const midi =
        role === 'bass'
          ? diatonicMidi(rootPc, mode, poolIdx === 0 ? deg : deg + 4, baseOct)
          : diatonicMidi(rootPc, mode, chordTones[poolIdx % chordTones.length], baseOct);
      pitches[s] = midiToNote(midi);
      velocities[s] = 0.45 + 0.55 * Math.min(1, stats.density[s] / maxDensity);
    }

    return {
      id: pi,
      color,
      role,
      label: `${ROLE_LABELS[role]}`,
      steps,
      pitches,
      velocities,
      muted: false,
    };
  });

  return {
    rootPc,
    rootName: SOLFEGE[rootPc],
    modeName,
    chords,
    chordNames,
    bpm,
    seed,
    tracks,
  };
}

function padSteps(): boolean[] {
  const steps = new Array<boolean>(STEPS).fill(false);
  for (let b = 0; b < STEPS; b += STEPS_PER_BAR) steps[b] = true;
  return steps;
}

function assignRoles(palette: AnalyzedImage['palette']): Role[] {
  const n = palette.length;
  const roles = new Array<Role>(n);
  const taken = new Array<boolean>(n).fill(false);

  const pick = (score: (i: number) => number): number => {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      const s = score(i);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    taken[best] = true;
    return best;
  };

  // orden de prioridad musical: bajo (el más oscuro), manto (mayor cobertura),
  // arpegio (más saturado), campana (más brillante), luego pulso y bruma
  const order: Array<[Role, (i: number) => number]> = [
    ['bass', (i) => -palette[i].light],
    ['pad', (i) => palette[i].coverage],
    ['arp', (i) => palette[i].sat],
    ['bell', (i) => palette[i].light],
    ['pluck', (i) => palette[i].coverage],
    ['texture', () => 0],
  ];

  let assigned = 0;
  for (const [role, score] of order) {
    if (assigned >= n) break;
    roles[pick(score)] = role;
    assigned++;
  }
  return roles;
}
