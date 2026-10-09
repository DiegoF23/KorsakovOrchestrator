# Temas visuales

Requisitos para todo tema de Korsakov. Acordado con el usuario el 2026-10-05. **Matrix** es el primer tema, no el diseño base: más adelante pueden venir otros (por ejemplo, uno estilo JARVIS de Iron Man).

## Principios

1. **Nada de colores, fuentes ni efectos fijos en el código.** Todo pasa por variables CSS (tokens). Un componente nuevo no puede traer colores propios.
2. **Cambiar de tema no cambia el comportamiento**, solo la apariencia. Ninguna función depende del tema elegido.
3. **La información se lee igual en todos los temas.** El fondo animado nunca tapa ni compite con el texto.

## Qué define un tema

Cada tema es un manifiesto con:

| Parte | Qué contiene |
|---|---|
| Identidad | `id` (por ejemplo `matrix`), nombre visible, autor, versión |
| Colores base | fondo, tarjeta, panel, borde, texto, texto secundario, acento |
| Colores de estado | trabajando, terminado, detenido, esperando, sin reporte, aviso, error. **Mismo significado en todos los temas**; cambia el tono, no el sentido |
| Paleta de ramas | lista de colores para las líneas del árbol de git y las pestañas por rama |
| Resaltado de código | colores para palabras clave, cadenas, comentarios, números, etc. (visor de código) |
| Terminal | los 16 colores ANSI de la mini terminal |
| Tipografía | fuente de texto, fuente monoespaciada (código y terminal), fuente de títulos; con su archivo local y su licencia |
| Efectos | brillos, parpadeos, bordes animados; cada uno con su versión apagada |
| Fondo animado | módulo opcional (ver abajo) |

Se aplica con `data-theme="<id>"` en la raíz del documento. La elección se recuerda en el navegador (envuelta en try/catch) y se cambia desde un selector en el encabezado, al lado del de proyectos.

## Fondo animado

Pensado para temas como la lluvia de código de Matrix o las interfaces holográficas de JARVIS.

- Va en **una capa propia detrás de todo** (`canvas` o CSS), sin recibir clics.
- Es un módulo que se enciende y se apaga, con una interfaz mínima: `start(canvas, tokens)`, `stop()`, `resize()`.
- **Presupuesto de rendimiento:** no puede trabar el monitor. Máximo ~30 cuadros por segundo; se pausa cuando la pestaña no está visible (`document.hidden`); baja la intensidad si el equipo está cargado.
- Respeta **`prefers-reduced-motion`**: con esa preferencia, el fondo queda quieto.
- Tiene un **interruptor propio** para apagarlo sin cambiar de tema.
- Detrás de paneles con texto se usa un velo semitransparente para mantener el contraste.

## Contraste y accesibilidad

- Texto normal con contraste mínimo 4.5:1 contra su fondo (WCAG AA); textos grandes y bordes, 3:1.
- Los estados no se distinguen solo por color: también llevan texto o ícono (como hoy, "trabajando", "terminado").

## Recursos

- Fuentes e imágenes **dentro del proyecto** (`monitor/public/`), nunca cargadas desde internet en tiempo de ejecución: la app corre solo en localhost y debe funcionar sin conexión.
- Cada fuente o imagen con su licencia junto al archivo (como `public/fonts/OFL.txt`).

## Cómo se agrega un tema nuevo

1. Copiar el manifiesto de Matrix con un `id` nuevo.
2. Completar todos los tokens (un tema incompleto hereda los de Matrix y avisa en la consola).
3. Opcional: su módulo de fondo animado.
4. Verificar contraste y probar con el fondo apagado y con `prefers-reduced-motion`.

## Matrix (tema actual)

- Colores: los de hoy (`--bg #000`, `--live #00ff41`, `--text #35e05f`, `--dim #00a333`, etc.).
- Tipografía actual: **Share Tech Mono** (títulos) y **Cascadia Mono / Consolas** (texto). No es la tipografía de la película: el logo de *The Matrix* es letra dibujada a medida sobre Times, y los caracteres de la lluvia son un juego propio de Simon Whiteley (katakana espejados, letras y números) que nunca se publicó oficialmente. Existen recreaciones hechas por fans; antes de incluir alguna hay que revisar su licencia.
- Fondo animado: candidato natural, la lluvia de código.

## Temas disponibles (2026-10-09)

Cada tema elige también el estilo de las ramas del árbol de git con `--rail-style` y su fuente con `--rail-font`.

| Tema | Ramas del árbol | Fondo animado |
|---|---|---|
| `matrix` | `binary`: dígitos 0/1 que suben por cada rama | lluvia de código |
| `claude-desktop` | `line`: líneas suaves, nodos redondos | mascota pixel-art que reacciona a lo que hacen los agentes (escribe, construye, lee) |
| `bash` | `ascii`: `*`, `|`, `/`, `\\` como `git log --graph`, cursor parpadeante en el commit nuevo | ninguno |
| `naruto` | `line` | atardecer difuminado con hojas verdes; si existe `monitor/public/img/naruto-wallpaper.(webp\|jpg\|png)` (imagen personal, ignorada por git) la reconstruye para cualquier forma de pantalla |
| `vscode` | `ring`: línea gruesa con nodos en anillo | editor fantasma que escribe código con varios cursores, Error Lens y minimapa |
| `jarvis` | `ring` con brillo | HUD holográfico: reactor de anillos, radar, rejilla hexagonal, lecturas numéricas |

Reglas aprendidas al construirlos:
- Todo bloque de tema define la **unión** de los tokens `--scene-*` de todos los temas (un test lo exige).
- Los paneles (`--panel`, `--card`) deben ser **traslúcidos** (alfa 0,5 a 0,65) y `--rain-opacity` alto; con paneles sólidos el fondo queda tapado.
- El fondo recibe `update(feed)` con `{ working, total, engines, kinds, errors }`; sirve para reaccionar a la actividad.
- La paleta de `vscode` es una aproximación (One Dark Pro) y no está verificada contra la configuración real de ningún desarrollador.
