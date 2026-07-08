# CRATER ◦

**Convierte imágenes en paisajes sonoros ambient.**
Suelta un PNG y escúchalo derrumbarse: cada color es un acorde, cada píxel un grano de arena, cada columna un paso en el tiempo.

*Turn images into ambient soundscapes. Drop a PNG and listen to it collapse: every color is a chord, every pixel a grain of sand, every column a step in time.*

## Cómo funciona el algoritmo (píxeles → sonido)

1. **Paleta como armonía.** La imagen se reduce y se agrupa en ~6 colores dominantes con k-means
   (una especie de "Pantone" de la foto). El matiz del color dominante elige la **nota raíz**
   (360° de matiz → 12 clases de altura), y la calidez × luminosidad de la imagen eligen el
   **modo**: cálida y brillante → lidio, fría y oscura → frigio, con toda la gama entre medias.
   Cada color se convierte en un **acorde diatónico** (su matiz relativo al dominante elige el
   grado de la escala), así que la progresión de 4 acordes sale literalmente de la paleta y
   siempre es armónica.

2. **Píxeles como secuencia.** La imagen se divide en **32 columnas** — la línea de tiempo.
   La densidad de cada color en cada columna decide *cuándo* suena su instrumento, y la altura
   promedio de esos píxeles decide *qué nota* del acorde (arriba en la imagen = más agudo).
   La canción se "lee" de izquierda a derecha, como una partitura pintada.

3. **Roles por carácter del color.**
   | Rol | Se asigna a | Sintetizador |
   |---|---|---|
   | ABISMO (bajo) | el color más oscuro | MonoSynth triangular |
   | MANTO (pad) | el de mayor cobertura | FM polifónico, ataque de 2s |
   | ARPEGIO | el más saturado | Synth triangular corto |
   | CAMPANA | el más brillante | FM inharmónico (harmonicity 5.07) |
   | PULSO | siguiente por cobertura | Karplus-Strong (cuerda pulsada) |
   | BRUMA | el que queda | Ruido rosa filtrado con LFO |

   Todo pasa por reverb de 9 segundos y delay ping-pong: territorio Aphex Twin
   (*Selected Ambient Works*, era el brief).

4. **Arena.** La imagen se renderiza como ~6.500 granos. Al pulsar **derrumbar**, cada grupo de
   color se desprende en secuencia con física de gravedad y apilamiento; cuando un grupo cae,
   su pista entra con un fade. Los granos parpadean cuando su instrumento dispara una nota.
   **Reformar** invierte el proceso y devuelve la imagen.

## Jugar

- **derrumbar / pausa / reanudar** — también con la barra espaciadora
- Clic en las celdas de la línea de tiempo para **editar el patrón** mientras suena
- Clic en el cuadrito de color de cada pista para **silenciarla**
- Cambia **raíz**, **modo** y **bpm**, o pulsa **⟳ reimaginar** para otra variación de la misma imagen
- Sin imagen a mano: tres demos procedurales (*Atardecer*, *Nebulosa*, *Vergel*)

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build → dist/
```

Stack: Vite · React 18 · TypeScript · Tone.js 15 · Canvas 2D. Sin backend: todo ocurre en tu navegador.

## Hoja de ruta (modo juego)

- **Niveles**: cada nivel es una imagen misteriosa; el objetivo es reconstruir su armonía
  reordenando pasos con un número limitado de movimientos.
- **Personaje**: un grano de arena que surfea el playhead; los pasos activos son plataformas.
- **Puntuación por consonancia**: qué tan cerca quedó tu edición de la armonía "natural" de la imagen.

---

Hecho con Claude Code. 🕳️🎶
