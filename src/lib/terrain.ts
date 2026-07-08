import { mulberry32 } from './rng';

// Nivel 1 — La Espiral: la silueta de las dunas es una superposición de ondas
// con frecuencias de Fibonacci (1, 2, 3, 5, 8, 13) cuyas amplitudes decaen por
// el número áureo φ. El paisaje entero respira proporciones áureas.

const PHI = (1 + Math.sqrt(5)) / 2;
const FIB = [1, 2, 3, 5, 8, 13];

// perfil objetivo normalizado 0..1 por columna
export function fibonacciProfile(numCols: number, seed: number): Float32Array {
  const rng = mulberry32(seed ^ 0x51e57e11);
  const phases = FIB.map(() => rng() * Math.PI * 2);
  const profile = new Float32Array(numCols);
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < numCols; c++) {
    const x = c / numCols;
    let v = 0;
    for (let k = 0; k < FIB.length; k++) {
      v += Math.sin(Math.PI * 2 * FIB[k] * x + phases[k]) / Math.pow(PHI, k);
    }
    profile[c] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1e-6, max - min);
  for (let c = 0; c < numCols; c++) {
    profile[c] = (profile[c] - min) / span;
  }
  return profile;
}

// posiciones áureas para los orbes: las secciones 1/φ³, 1/φ², 1/φ del mapa
export const GOLDEN_SECTIONS = [1 / PHI ** 3, 1 / PHI ** 2, 1 / PHI];

// escala el perfil para que el área bajo la curva coincida con la arena disponible
export function scaleProfileToArea(profile: Float32Array, targetArea: number): Float32Array {
  let area = 0;
  for (let c = 0; c < profile.length; c++) area += profile[c];
  const base = 0.25; // altura mínima: ninguna zona del mapa queda plana del todo
  const scaled = new Float32Array(profile.length);
  const k = targetArea / Math.max(1e-6, area + base * profile.length);
  for (let c = 0; c < profile.length; c++) {
    scaled[c] = (profile[c] + base) * k;
  }
  return scaled;
}
