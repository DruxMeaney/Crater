export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  hue: number; // 0-360
  sat: number; // 0-1
  light: number; // 0-1
  coverage: number; // fracción de píxeles 0-1
  code: string; // código estilo pantone: "CRTR 214-63"
}

export interface AnalyzedImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA a resolución de análisis
  groups: Int16Array; // índice de paleta por píxel (-1 = transparente)
  palette: PaletteColor[]; // ordenada por cobertura desc
}

export type Role = 'pad' | 'bass' | 'arp' | 'pluck' | 'bell' | 'texture';

export const ROLE_LABELS: Record<Role, string> = {
  pad: 'MANTO',
  bass: 'ABISMO',
  arp: 'ARPEGIO',
  pluck: 'PULSO',
  bell: 'CAMPANA',
  texture: 'BRUMA',
};

export interface Track {
  id: number; // índice en la paleta
  color: PaletteColor;
  role: Role;
  label: string; // "MANTO · Rem7"
  steps: boolean[]; // 32 pasos
  pitches: string[]; // nota por paso, ej "D4"
  velocities: number[]; // 0-1 por paso
  muted: boolean;
}

export interface Composition {
  rootPc: number; // pitch class 0-11
  rootName: string; // solfeo: "Re"
  modeName: string; // "dórico"
  chords: string[][]; // 4 acordes (notas con octava) para el pad
  chordNames: string[]; // "Rem7", ...
  bpm: number;
  seed: number;
  tracks: Track[];
}

export type Phase = 'intact' | 'collapsing' | 'collapsed' | 'reforming';

export const STEPS = 32;
export const BARS = 4;
export const STEPS_PER_BAR = STEPS / BARS;
