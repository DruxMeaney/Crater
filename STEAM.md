# Camino a Steam 🎮

Crater ya corre como app de escritorio nativa (Electron). Este documento es el mapa
para convertir eso en un lanzamiento en Steam.

## Por qué Electron y no otra cosa

- **El núcleo web se conserva**: el mismo código corre en crater-indol.vercel.app (demo
  gratuita / marketing) y en la app de escritorio (producto Steam). Un solo codebase.
- **Precedente sólido**: *CrossCode* (NW.js) y las primeras versiones de *Vampire
  Survivors* (Phaser + Electron) despacharon millones de copias en Steam con tecnología web.
- **Web Audio consistente**: Electron empaqueta Chromium, así que el motor de audio suena
  idéntico en Windows/macOS/Linux. La alternativa ligera (Tauri) usa el webview del sistema
  y el audio/timing varía por plataforma — riesgo inaceptable para un juego musical.
- **Escape futuro**: si el modo juego crece hacia algo pesado (3D, física seria), el
  algoritmo paleta→armonía es lógica pura de TypeScript, portable a Godot sin dolor.

## Estado actual

| Pieza | Estado |
|---|---|
| App de escritorio (ventana, file://, enlaces externos seguros) | ✅ `npm run app` |
| Empaquetado instalable (dmg / nsis / AppImage) | ✅ `npm run dist:app` |
| Prueba de humo para CI | ✅ `npm run app:smoke` |
| Steamworks (logros, overlay, rich presence) | ⬜ pendiente |
| Modo caminata: el Grano, pasos sonoros, ecos, reconstrucción | ✅ prototipo jugable |
| Modo juego completo (niveles, campaña, puntuación) | ⬜ pendiente — ver README |

## Pasos hacia el lanzamiento

1. **Jugabilidad primero.** Steam castiga los "toys" sin objetivos: conviene tener el modo
   juego (niveles + personaje surfeando el playhead) antes de pagar el ticket de entrada.
2. **Steam Direct**: cuenta de Steamworks + $100 USD por app (recuperables tras $1.000 en
   ventas). Preparar página de tienda (capturas, tráiler, descripción).
3. **Integración Steamworks**: el paquete npm [`steamworks.js`](https://github.com/ceifa/steamworks.js)
   funciona con Electron sin recompilar nada — logros ("primer derrumbe", "12 imágenes
   escuchadas"), stats, y cloud saves de composiciones editadas.
4. **Builds por plataforma**: `electron-builder` ya genera los tres targets; Steam los sube
   con `steamcmd` (un depot por SO). Firmar el build de macOS (Apple Developer ID, $99/año)
   y el de Windows si se quiere evitar SmartScreen.
5. **Overlay de Steam**: en Electron requiere `--in-process-gpu` o deshabilitar el overlay;
   probarlo temprano — es el escollo clásico de los juegos Electron.

## Ideas de diseño para el modo juego

- **Modo campaña**: cada nivel es una imagen misteriosa que se revela al completarla.
- **El Grano**: personaje que surfea la línea de tiempo; los pasos activos son plataformas,
  los silencios huecos. La música ES el nivel.
- **Puzzle de armonía**: reconstruir la melodía "natural" de la imagen en N movimientos.
- **Modo foto**: los jugadores suben sus fotos → niveles infinitos generados (¡el gancho
  viral del juego!).
