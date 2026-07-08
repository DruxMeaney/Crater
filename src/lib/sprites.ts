// Custodios: sprites pixel generados por código (ningún asset externo).
// Cada sprite es 16×18 px con 2 frames de caminata + 1 de reposo.

export type Character = 'lupa' | 'bruno' | 'andrea' | 'loti';

export interface CharacterInfo {
  id: Character;
  name: string;
  species: string;
  flag: string; // nombre de la bandera de su batita
}

export const CHARACTERS: CharacterInfo[] = [
  { id: 'lupa', name: 'Lupa', species: 'loba', flag: 'arcoíris' },
  { id: 'bruno', name: 'Bruno', species: 'oso', flag: 'bear' },
  { id: 'andrea', name: 'Andrea', species: 'humane', flag: 'no binaria' },
  { id: 'loti', name: 'Loti', species: 'nutria', flag: 'trans' },
];

const FLAGS: Record<Character, string[]> = {
  lupa: ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'],
  bruno: ['#623804', '#d56300', '#fedd63', '#fde6b8', '#ffffff', '#333333'],
  andrea: ['#fcf434', '#ffffff', '#9c59d1', '#2c2c2c'],
  loti: ['#5bcefa', '#f5a9b8', '#ffffff', '#f5a9b8', '#5bcefa'],
};

const SKIN: Record<Character, { base: string; light: string; dark: string }> = {
  lupa: { base: '#9aa3b2', light: '#c6ccd8', dark: '#6b7280' },
  bruno: { base: '#8a6444', light: '#b08a60', dark: '#5f4530' },
  andrea: { base: '#c68e6b', light: '#e0ac8a', dark: '#8a5c40' },
  loti: { base: '#7a5c3e', light: '#c9b08a', dark: '#54402c' },
};

export const SPRITE_W = 16;
export const SPRITE_H = 18;

export interface SpriteSet {
  frames: HTMLCanvasElement[]; // [reposo, paso A, paso B], mirando a la derecha
}

export function buildSprite(char: Character): SpriteSet {
  return { frames: [makeFrame(char, 0), makeFrame(char, 1), makeFrame(char, 2)] };
}

export function spriteDataUrl(char: Character, scale = 5): string {
  const frame = makeFrame(char, 0);
  const c = document.createElement('canvas');
  c.width = SPRITE_W * scale;
  c.height = SPRITE_H * scale;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, 0, 0, c.width, c.height);
  }
  return c.toDataURL();
}

function makeFrame(char: Character, frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE_W;
  c.height = SPRITE_H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  const row = (x0: number, x1: number, y: number, color: string) => {
    for (let x = x0; x <= x1; x++) px(x, y, color);
  };

  const skin = SKIN[char];
  const flag = FLAGS[char];
  const eye = '#f6d9a8'; // ojos que brillan bajo la capucha
  const cowl = '#232839'; // la capucha del custodio

  // --- cabeza (mirando a la derecha), y = 0..6 ---
  switch (char) {
    case 'lupa':
      px(5, 0, skin.dark);
      px(9, 0, skin.dark);
      px(5, 1, skin.base);
      px(9, 1, skin.base);
      for (let y = 2; y <= 5; y++) row(4, 10, y, skin.base);
      row(10, 12, 4, skin.light); // hocico
      px(12, 4, '#2a2431'); // nariz
      row(4, 10, 6, skin.dark);
      px(9, 3, eye);
      break;
    case 'bruno':
      row(4, 5, 0, skin.base);
      row(9, 10, 0, skin.base);
      for (let y = 1; y <= 5; y++) row(4, 10, y, skin.base);
      row(9, 11, 4, skin.light); // morro
      px(11, 4, '#2a2431');
      row(4, 10, 6, skin.dark);
      px(8, 3, eye);
      break;
    case 'andrea': {
      const hair = '#5a4a6e';
      row(4, 10, 0, hair);
      row(3, 10, 1, hair);
      row(3, 4, 2, hair);
      row(5, 10, 2, skin.base);
      for (let y = 3; y <= 5; y++) {
        px(3, y, hair);
        row(4, 10, y, skin.base);
      }
      row(4, 10, 6, skin.dark);
      px(9, 3, eye);
      px(10, 5, '#a05858'); // sonrisa
      break;
    }
    case 'loti':
      px(4, 1, skin.base);
      px(10, 1, skin.base);
      for (let y = 2; y <= 5; y++) row(4, 10, y, skin.base);
      row(8, 11, 4, skin.light); // carita clara
      row(8, 11, 5, skin.light);
      px(11, 3, '#2a2431'); // nariz
      px(12, 4, skin.light); // bigote
      px(12, 5, skin.light);
      row(4, 10, 6, skin.dark);
      px(9, 3, eye);
      break;
  }

  // --- capucha: el manto envuelve la nuca y la frente; el hocico y las
  // orejas asoman por delante, y los ojos brillan en la sombra ---
  row(3, 8, 0, cowl);
  for (let y = 1; y <= 6; y++) {
    px(2, y, cowl);
    px(3, y, cowl);
  }
  row(3, 6, 1, cowl);
  px(4, 2, cowl);
  px(5, 2, cowl);

  // --- batita con la bandera, y = 7..13 (ligeramente acampanada) ---
  const stripes = flag.length;
  for (let y = 7; y <= 13; y++) {
    const t = (y - 7) / 7;
    const half = 3 + Math.round(t * 2); // se ensancha hacia abajo
    const color = flag[Math.min(stripes - 1, Math.floor(((y - 7) / 7) * stripes))];
    row(7 - half, 7 + half, y, color);
    px(7 - half, y, shade(color, 0.72)); // borde sombreado
    px(7 + half, y, shade(color, 0.72));
  }
  // bracito
  px(11, 8, skin.base);
  px(11, 9, skin.base);

  // cola de nutria / loba
  if (char === 'loti') {
    row(1, 3, 12, skin.base);
    row(0, 2, 13, skin.base);
  }
  if (char === 'lupa') {
    px(2, 11, skin.base);
    row(1, 3, 12, skin.light);
  }

  // --- piernitas, y = 14..17: tres frames de caminata ---
  const boot = '#2a2431';
  if (frame === 0) {
    // reposo: juntas
    row(5, 6, 14, skin.dark);
    row(8, 9, 14, skin.dark);
    row(5, 6, 15, boot);
    row(8, 9, 15, boot);
  } else if (frame === 1) {
    // paso A: izquierda adelante
    row(8, 9, 14, skin.dark);
    row(9, 10, 15, boot);
    row(4, 5, 14, skin.dark);
    row(3, 4, 15, boot);
  } else {
    // paso B: derecha adelante
    row(5, 6, 14, skin.dark);
    row(4, 5, 15, boot);
    row(8, 9, 14, skin.dark);
    row(9, 10, 15, boot);
    row(6, 8, 14, skin.dark);
  }

  return c;
}

function shade(hex: string, f: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * f);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * f);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * f);
  const to = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
