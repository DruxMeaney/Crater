# CRATER — documento de diseño 🕳️✦

## El lore: La Pinacoteca Somnia

**El Coleccionista** construyó una galería entre mundos: la *Pinacoteca Somnia*, donde
guarda los cuadros más amados de la humanidad. Pero los cuadros están enfermando de
**la Muda**: su pintura pierde adherencia y cae, grano a grano, como arena de colores.
Y con el color se va **el Canto** — porque en la Pinacoteca cada cuadro *suena*: su
paleta es su armonía, sus formas son su melodía.

Tú eres un **Custodio**: un espíritu guardián que puede entrar a los cuadros
atravesando **el Marco** (la entrada estilo TRON: la cámara se hunde en el lienzo y
el mundo digital-pictórico te absorbe). Dentro, caminas sobre las dunas de pintura
caída, recoges los **Orbes de Canto** que quedaron enterrados donde el color era más
intenso, y con ellos ejecutas el **Hechizo de Reconstrucción** que devuelve el color
al lienzo.

Lo que queda tras el hechizo no es un hueco: es **arena de ceniza** — la duna
conserva su forma pero pierde su color, como la huella que la pintura dejó en el
mundo. La superficie permanece; el alma vuelve al cuadro. (Así resolvemos la
paradoja: restauras la imagen *y* el nivel sigue siendo caminable.)

## Los Custodios (elegibles, con batitas de la diversidad)

| Custodio | Batita | Personalidad |
|---|---|---|
| **Lupa** la loba | arcoíris 🏳️‍🌈 | veloz, aúlla en la cresta de las dunas |
| **Bruno** el oso | bandera bear | firme, sus pasos suenan una octava abajo |
| **Andrea** humane no binarie | bandera no binaria | equilibrade, oye los ecos desde más lejos |
| **Loti** la nutria | bandera trans | juguetona, nada en la arena |

(En el prototipo las diferencias son visuales; las habilidades llegan después.)

## Estructura de niveles: cada cuadro vive en una figura matemática

La regla creativa central: **cada nivel es un cuadro famoso en dominio público, y su
mundo está construido con una figura matemática distinta.** La atmósfera, el terreno
y la música usan las proporciones de esa figura.

1. **La Espiral** — *La noche estrellada* (Van Gogh, 1889, dominio público).
   Terreno esculpido con armónicos de Fibonacci: la silueta de las dunas es una
   superposición de ondas con frecuencias 1, 2, 3, 5, 8, 13 y amplitudes que decaen
   por el número áureo φ. Los orbes están en las secciones áureas del mapa
   (posiciones 1/φ³, 1/φ², 1/φ). Van Gogh pintó remolinos áureos; el nivel es uno.
2. **El Cubo** — *(cuadro por elegir, quizás Escher-esco)*. Aquí vive tu idea del
   cubo: ves una cara; al cruzar el borde, el mundo GIRA y revela otra — 6 caras
   explorables en potencia. La guardamos para el nivel 2-3 porque merece su propio
   cuadro y su propia mecánica de gravedad, no competir con Fibonacci en el tutorial.
3. **La Ola** — *La gran ola de Kanagawa* (Hokusai): terreno de fractal de olas.
4. **El Toro** — mundo que envuelve en ambas direcciones (pac-man geométrico).

## Sistema de juego

- **Caminar y saltar** sobre superficies generadas matemáticamente. Cada paso suena
  una nota consonante con el Canto del cuadro (la altura de la duna elige el tono).
- **Barra de vida** (la Muda te desgasta en niveles avanzados; en el nivel 1 es tutorial).
- **Barra de magia**: se carga recogiendo orbes (3 orbes = carga completa).
- **Hechizos como items**: empiezas solo con **Reconstrucción**. Con 3 orbes y la
  magia llena, al ejecutarlo la pantalla se vuelve turbulenta y mágica: la arena
  entera tiembla, se arremolina y asciende en enjambre para recomponer el cuadro.
  Futuros hechizos: *Eco* (revela orbes ocultos), *Puente* (arena solidificada),
  *Silencio* (congela la Muda).
- **Acertijos** (siguiente iteración): "acordes-cerradura" — puertas que solo se
  abren si reordenas los pasos del secuenciador para tocar la progresión oculta del
  cuadro. El acertijo ES musical: el conocimiento del Canto es la llave.

## Por qué así

- **Todo generado con matemáticas**: sprites dibujados por código, terreno por
  ecuaciones, música por proporciones de color. Ningún asset externo.
- **Los cuadros famosos justifican la imagen inicial** y son gratis legalmente
  (dominio público). El modo libre (subir tu propia foto) se vuelve "la Sala de
  Invitados" de la Pinacoteca.
- **TRON como rito de entrada**: el Marco es el portal; entrar al cuadro es el
  momento cinemático de cada nivel.
