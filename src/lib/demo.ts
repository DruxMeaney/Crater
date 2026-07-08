// Imágenes de demostración generadas proceduralmente, para jugar sin subir nada.

export interface DemoImage {
  name: string;
  dataUrl: string;
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 360;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  return [c, ctx];
}

function atardecer(): string {
  const [c, ctx] = makeCanvas();
  const sky = ctx.createLinearGradient(0, 0, 0, 250);
  sky.addColorStop(0, '#1a1440');
  sky.addColorStop(0.45, '#7a2c5e');
  sky.addColorStop(0.8, '#e35b3c');
  sky.addColorStop(1, '#f2a65a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 480, 250);
  // sol
  ctx.fillStyle = '#ffd27d';
  ctx.beginPath();
  ctx.arc(330, 210, 46, 0, Math.PI * 2);
  ctx.fill();
  // mar
  const sea = ctx.createLinearGradient(0, 250, 0, 360);
  sea.addColorStop(0, '#3c2a55');
  sea.addColorStop(1, '#141c38');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 250, 480, 110);
  // reflejos
  ctx.fillStyle = '#f2a65a';
  for (let i = 0; i < 14; i++) {
    const y = 256 + i * 7;
    const w = 60 - i * 3.5;
    ctx.globalAlpha = 0.5 - i * 0.03;
    ctx.fillRect(330 - w / 2, y, w, 3);
  }
  ctx.globalAlpha = 1;
  return c.toDataURL('image/png');
}

function nebulosa(): string {
  const [c, ctx] = makeCanvas();
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, 480, 360);
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(5,6,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(180, 150, 190, 'rgba(110,60,190,0.85)');
  blob(300, 220, 160, 'rgba(50,130,200,0.7)');
  blob(120, 260, 120, 'rgba(200,60,130,0.55)');
  blob(380, 90, 100, 'rgba(70,200,190,0.5)');
  // estrellas (posiciones deterministas)
  ctx.fillStyle = '#f0ecff';
  let s = 7;
  for (let i = 0; i < 90; i++) {
    s = (s * 16807) % 2147483647;
    const x = s % 480;
    s = (s * 16807) % 2147483647;
    const y = s % 360;
    const size = i % 11 === 0 ? 2 : 1;
    ctx.fillRect(x, y, size, size);
  }
  return c.toDataURL('image/png');
}

function vergel(): string {
  const [c, ctx] = makeCanvas();
  const bg = ctx.createLinearGradient(0, 0, 0, 360);
  bg.addColorStop(0, '#dce8b8');
  bg.addColorStop(0.5, '#7fae5e');
  bg.addColorStop(1, '#23402a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 480, 360);
  // troncos
  ctx.fillStyle = '#3a2c22';
  const xs = [60, 150, 250, 340, 430];
  for (const x of xs) ctx.fillRect(x - 7, 120, 14, 240);
  // copas
  const copa = (x: number, y: number, r: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  copa(60, 110, 55, '#2f5c33');
  copa(150, 90, 62, '#47804a');
  copa(250, 105, 58, '#2f5c33');
  copa(340, 85, 66, '#5d9a55');
  copa(430, 110, 52, '#47804a');
  // haces de luz
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#f5f0c0';
  ctx.beginPath();
  ctx.moveTo(200, 0);
  ctx.lineTo(260, 0);
  ctx.lineTo(180, 360);
  ctx.lineTo(120, 360);
  ctx.fill();
  ctx.globalAlpha = 1;
  return c.toDataURL('image/png');
}

// homenaje procedural a La noche estrellada (Van Gogh, 1889, dominio público):
// remolinos áureos, estrellas con halo, el ciprés como llama oscura
function nocheEstelar(): string {
  const [c, ctx] = makeCanvas();
  const bg = ctx.createLinearGradient(0, 0, 0, 360);
  bg.addColorStop(0, '#1b2a5e');
  bg.addColorStop(0.6, '#2a4485');
  bg.addColorStop(1, '#16204a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 480, 360);
  // remolinos: espirales de trazos
  const swirl = (cx: number, cy: number, r0: number, turns: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let t = 0; t <= turns * Math.PI * 2; t += 0.15) {
      const r = r0 * (1 - t / (turns * Math.PI * 2 + 1));
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r * 0.62;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  swirl(200, 120, 90, 2.2, '#7ea0d8');
  swirl(210, 125, 60, 1.8, '#b8cbe8');
  swirl(340, 80, 50, 1.6, '#8fb0e0');
  // estrellas con halo
  const star = (x: number, y: number, r: number) => {
    ctx.fillStyle = 'rgba(240,220,130,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2d878';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  star(70, 60, 9);
  star(300, 40, 6);
  star(420, 120, 7);
  star(120, 160, 5);
  star(440, 40, 11); // la luna-sol
  // colinas
  ctx.fillStyle = '#22315e';
  ctx.beginPath();
  ctx.moveTo(0, 250);
  ctx.quadraticCurveTo(150, 210, 300, 255);
  ctx.quadraticCurveTo(400, 285, 480, 260);
  ctx.lineTo(480, 360);
  ctx.lineTo(0, 360);
  ctx.fill();
  // aldea
  ctx.fillStyle = '#141c38';
  for (let i = 0; i < 7; i++) {
    const x = 150 + i * 40;
    ctx.fillRect(x, 285 - (i % 3) * 8, 22, 40);
  }
  ctx.fillStyle = '#e8c86a';
  for (let i = 0; i < 7; i++) {
    const x = 156 + i * 40;
    ctx.fillRect(x, 295 - (i % 3) * 8, 4, 5);
  }
  // el ciprés: llama oscura
  ctx.fillStyle = '#0e1a14';
  ctx.beginPath();
  ctx.moveTo(60, 360);
  ctx.quadraticCurveTo(40, 260, 62, 190);
  ctx.quadraticCurveTo(72, 150, 66, 120);
  ctx.quadraticCurveTo(84, 170, 78, 230);
  ctx.quadraticCurveTo(92, 300, 84, 360);
  ctx.fill();
  return c.toDataURL('image/png');
}

export function makeDemos(): DemoImage[] {
  return [
    { name: 'Noche estelar', dataUrl: nocheEstelar() },
    { name: 'Atardecer', dataUrl: atardecer() },
    { name: 'Nebulosa', dataUrl: nebulosa() },
    { name: 'Vergel', dataUrl: vergel() },
  ];
}
