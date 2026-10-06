# Fleet Monitor

Panel web local, de solo lectura, que reemplaza la vista de la terminal del kit de
autopiloto. Conserva todas las fuentes de datos tal como están: los scripts de
`tools/autopilot/` (tablero y monitores) siguen siendo la implementación de
referencia de qué leer y cómo, y no se modifican.

Es una aplicación autocontenida (Node 24, solo módulos integrados, sin
dependencias npm). No importa código de las apps de Flota y puede moverse a su
propio repositorio sin cambios.

## Arranque

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\fleet-monitor\start.ps1
```

Abre `http://127.0.0.1:4200/`. El script inicia el servidor oculto si no está
corriendo y es idempotente: si ya está arriba, solo vuelve a abrir la página.

Para correrlo a mano:

```powershell
node tools\fleet-monitor\server.mjs
```

El servidor escucha **solo en 127.0.0.1** (un host distinto en la configuración
se fuerza de vuelta a loopback), sirve `GET /` con la página y
`GET /api/state` con una foto JSON. No escribe nada, no mata ni lanza procesos:
solo lee archivos y ejecuta `git` y consultas de sistema de solo lectura. La
única excepción es la capa de traducción (ver más abajo): guarda su caché en
`translations.json` y llama al helper en segundo plano.

## Qué muestra

La página usa una sola pantalla sin scroll: barra superior (título, hora de
actualización, orquestador, medidores de consumo y línea del PC), tablero de
pistas con tarjetas que se achican a medida que hay más constructores (8 líneas
de actividad hasta 4 pistas, 4 hasta 8 y 2 de ahí en adelante, cada una en un
renglón con puntos suspensivos y el texto completo en el tooltip) y el árbol de
git con scroll propio ocupando el espacio libre, que se convierte en una tarjeta
más de la grilla cuando ese espacio se achica demasiado (ver el punto 4).

1. **Barra superior**: título `Monitor`, el orquestador como
   `ORQUESTADOR: <modelo> · <nivel>` (por ejemplo
   `ORQUESTADOR: claude-opus-5-5 · high`, con el `label` del motor en el
   tooltip), hora de actualización, línea del PC (CPU, RAM y disco C: con
   semáforo) y un renglón por medidor de consumo (Claude, Codex y OpenCode Go):
   nombre, barra de 5 h con porcentaje y hora de reinicio, barra semanal con
   porcentaje y antigüedad del dato (`actualizado hace 12 min`). Las barras son
   grandes y cambian de color según el nivel: verde abajo de 70 %, ámbar entre
   70 % y 89 %, rojo desde 90 %. El medidor del motor del orquestador va
   primero. Cuando el dato de Claude tiene más de 30 minutos, sus barras se
   atenúan; nunca inventa valores.
2. **Agentes · N activos / M en total**: una tarjeta por pista con `board: true`
   del `kit.config.json`, con el número de tarjetas en estado `trabajando` sobre
   el total. El título es el mismo de la terminal
   (`OPENCODE A - <título> - ~H:MM` / `CODEX - <título> - ~H:MM`), con la cuenta
   regresiva, `terminado` o `detenido`; debajo van el modelo con su nivel
   (`deepseek-v4.1-flash · max`; en las pistas de Claude Code sale del `effort`
   de la pista y dice `por defecto` cuando falta) y una línea corta del color que el árbol de git
   le da a la rama de esa pista (gris tenue si la rama no tiene carril visible),
   el último commit de la rama (con su asunto traducido al español) y las
   últimas líneas de actividad (comandos, ediciones,
   lecturas, mensajes, commits, errores con hora y, en Claude Code, el total de
   tokens). Las pistas que están
   trabajando muestran además, debajo del título, un resumen corto en español de
   lo que están haciendo (ver "Traducciones y resúmenes"). Cada estado pinta su
   chip y su título: ámbar `trabajando`, verde `terminado`, rojo `detenido` /
   BLOCKED y celeste `esperando` o cualquier otro estado. Las tarjetas verdes y
   rojas llevan un borde animado estilo Tron: un punto brillante recorre el
   borde seguido de una cola corta de puntos; con `prefers-reduced-motion` queda
   un brillo fijo. Las pistas de Claude Code pueden declarar `activityFile`
   (ruta absoluta a la transcripción JSONL del subagente) para llenar sus
   líneas de actividad y su total de tokens (ver "Límites conocidos").
3. **Línea del PC**: CPU, RAM y disco C: con semáforo verde / amarillo / rojo,
   compacta en la barra superior.
4. **Árbol de git**: un grafo SVG animado (carriles por rama, nodos y etiquetas
   de rama/HEAD, con el color de cada carril asignado de forma determinista por
   nombre de rama —la misma función que usa la línea de las tarjetas—, asunto,
   sha corto y tiempo relativo, lo más nuevo arriba) con
   scroll vertical propio, para recorrer todo el historial sin que la página se
   mueva. Mientras el espacio libre alcance, es un panel de ancho completo; si
   el espacio que le quedaría baja de una tarjeta de pista (140 px) o del 22 %
   del alto de la ventana, el árbol pasa a ser la **primera tarjeta de la grilla
   de agentes**, del mismo tamaño que las demás y con el mismo estilo: sin grafo
   ni etiquetas de rama, filas compactas con sha corto, asunto traducido y
   antigüedad, y su propio scroll. Cuando el espacio se libera, vuelve al panel;
   entre ambos umbrales hay 24 px de histéresis para que no parpadee. Los
   asuntos se muestran en español (traducidos por el helper; el inglés original
   queda en el tooltip) y el resto de los datos técnicos no se toca. Se arma con
   `git log --all --date-order --format=%H|%P|%D|%s|%ct -n 200`; cuando llega un
   commit nuevo entra con un fundido y un brillo breve, y con
   `prefers-reduced-motion` no hay animación.
5. **Fondo animado**: lluvia digital de Matrix en un canvas de página completa,
   por detrás del contenido, con opacidad baja y ~20 fps, en pausa cuando la
   pestaña está oculta y apagada con `prefers-reduced-motion`. Las tarjetas
   mantienen un fondo oscuro opaco para que el texto se lea siempre.

No hay sección "Ramas activas".

## Tipografía

Los títulos (título de la página, encabezados de sección y títulos de las
tarjetas) usan **Share Tech Mono**, empaquetada localmente en
`public/fonts/share-tech-mono.woff2` y servida por el propio servidor en
`/fonts/...` (la CSP declara `font-src 'self'`). No hay CDN ni pedidos de red en
tiempo de ejecución. La licencia es SIL Open Font License 1.1 y su texto está en
`public/fonts/OFL.txt`; el cuerpo de la página sigue en la monoespaciada del
sistema para mantener la lectura.

La página consulta `/api/state` cada 5 segundos. Las lecturas caras se cachean en
el servidor: consumo 60 s, PC 10 s, árbol de git 10 s. La configuración
(`fleet-monitor.config.json` y el `kit.config.json`) se relee en cada consulta,
así que editarla (por ejemplo, el modelo del orquestador) surte efecto sin
reiniciar el servidor.

## Temas

La apariencia completa sale de tokens CSS: colores, fuentes, brillos y bordes
animados viven en un bloque `:root[data-theme="<id>"]` de `index.html` (con un
`:root` de respaldo que repite los valores de Matrix). El encabezado tiene un
selector **TEMA** —la elección se recuerda en el navegador— y un interruptor
**FONDO** que enciende o apaga el fondo animado sin cambiar de tema. Hoy existe
solo **Matrix**, que reproduce el aspecto de siempre.

Para agregar un tema: copiar el bloque de Matrix con un `id` nuevo, completar
todos los tokens (estados, paleta de ramas 0–7, resaltado de código, colores
ANSI, tipografías y efectos) y, si el tema lo pide, sumar un módulo a
`BACKGROUNDS` con `start(canvas, tokens)`, `stop()` y `resize()`. Los requisitos
completos —contraste, fuentes locales, fondo en una capa propia y a lo sumo
~30 fps— están en `docs/temas.md`.

## Visor en vivo

Cada tarjeta de pista con pasos disponibles (`stepsSupported`) suma un botón
**VER** / **OCULTAR** en su encabezado. Con el visor abierto, la página consulta
`GET /api/steps?project=<id>&worker=<pista>&since=<último id>` cada 2 segundos
(se detiene con el visor cerrado y cuando la pestaña no está visible) y
reproduce lo que hizo el agente con una animación de tipeo simulada: el texto
llega completo recién al terminar cada herramienta, así que se anima después,
como en Roo Code. La elección de abierto/cerrado por pista se recuerda en
`localStorage` y el refresco de 5 segundos del tablero nunca reinicia la
animación.

- **Pestañas**: cada archivo (escrituras, ediciones y lecturas del mismo
  archivo comparten una), cada comando (`$ <comando>`), cada llamada a memoria
  (`mem: <título o consulta>`), cada otra herramienta, una pestaña
  **mensajes** para los textos y una pestaña **pensando** compartida por todos
  los razonamientos. El nombre del archivo va como etiqueta y la
  ruta completa en el tooltip. Hay como máximo 12 pestañas: al superar el
  límite se descarta la más vieja que no esté activa. El color de cada pestaña
  sigue el estado del último paso (ámbar trabajando, verde terminado, rojo
  error) y el botón `▾` / `▸` pliega el visor hasta dejar solo la tira de
  pestañas.
- **Seguir**: por defecto el visor acompaña al agente y cada paso nuevo activa
  su pestaña. Al hacer clic en una pestaña queda fijada y el seguimiento se
  apaga; **SEGUIR** lo vuelve a encender.
- **Reproducción**: los pasos se animan en orden, uno por vez, y ninguno tarda
  más de ~3 segundos sin importar cuánto texto tenga. Si se acumulan más de 5
  pasos, los más viejos se completan al instante para alcanzar al agente, y
  **SALTAR** completa la animación actual. Con `prefers-reduced-motion` todo
  aparece de inmediato.
- **Visores**: escrituras y ediciones como hoja de código con números de línea
  (la edición muestra primero el texto viejo tachado y después tipea el nuevo);
  lecturas como una línea "leído" con un barrido sutil; mensajes en un panel
  simple. Los comandos, la memoria y las demás herramientas tienen fichas
  propias (ver abajo). Un paso `running` sin contenido muestra
  **escribiendo…** y se reemplaza cuando llega terminado, y `truncated: true`
  avisa **contenido recortado**. El resaltado de sintaxis es propio (sin
  librerías) para JS/TS, JSON, CSS, HTML, Markdown, PowerShell, Python y shell;
  las extensiones desconocidas quedan en texto plano.
- **Mini terminal** (comandos): panel oscuro con la fuente monoespaciada y los
  colores ANSI del tema (`--ansi-0` a `--ansi-15`). Primero se tipea el prompt
  `$ ` y el comando, después la salida aparece línea por línea (rápido, acotada
  a ~1,5 s) y al final va la línea de estado: `exit 0` en verde, `exit <n>` en
  rojo o `exit ?` en gris cuando no hay código. Un comando en curso muestra un
  cursor que parpadea. La salida se recorta a las últimas 400 líneas visibles y
  avisa **… N líneas anteriores** arriba. El parser ANSI es propio: soporta
  negrita, tenue, itálica, subrayado, colores de texto y fondo de 16 y de 256
  colores (mapeados al tono más cercano de los 16), y descarta cualquier otra
  secuencia de escape (movimientos de cursor, borrados, títulos OSC) en vez de
  mostrarla.
- **Ficha de memoria** (Engram): encabezado `ENGRAM · <acción>` con un ícono
  animado hecho solo con CSS y tokens. En `save`, `update` y `session_summary`
  muestra los chips del tipo, el título tipeado y el contenido en un bloque
  preformateado que conserva los saltos de línea y pinta las etiquetas
  `**What**:` en el color de acento (sin librería de Markdown). En `search`,
  `context` y `get_observation` tipea la consulta y después los resultados: si
  la salida es un JSON con una lista de elementos con `title` (en `results`,
  `observations` o la raíz) muestra una fila por elemento con su tipo e id,
  tipeadas una por una; si no, muestra el texto crudo. Un error pinta el borde
  de la ficha en rojo y tipea el texto del error.
- **Ficha de herramienta**: encabezado con el nombre (un prefijo `mcp__<servidor>__`
  se separa en un chip `servidor` y el nombre corto), los parámetros como JSON
  indentado con las claves en el color de acento y el resultado tipeado (texto
  plano si es una cadena, JSON si es un objeto), recortado visualmente a 200
  líneas.
- **Pensando** (razonamiento del modelo): todos los razonamientos comparten una
  sola pestaña **pensando**. Mientras el modelo piensa (el texto todavía no
  llegó) se ve un circuito-cerebro animado, armado con SVG y los colores del
  tema, y al lado `pensando m:ss` con el tiempo transcurrido actualizado cada
  segundo; con `prefers-reduced-motion` el ícono queda quieto y el contador
  sigue. Al terminar, el ícono se reemplaza por uno estático, aparece
  `pensó m:ss` (cuando hay tiempos) y el razonamiento se tipea como los
  mensajes; si supera los 4.000 caracteres se tipea solo el comienzo y un botón
  **ver todo** muestra el resto de inmediato.
- Todo el contenido de los agentes se inserta como texto (`textContent`), nunca
  como HTML, y todos los colores salen de los tokens del tema. El parser ANSI
  solo produce segmentos con un índice de color 0–15 que el visor pinta con
  `var(--ansi-N)`.

## Traducciones y resúmenes

Los commits en git siguen en inglés; el panel traduce **solo la vista** con un
modelo gratuito de OpenCode, el mismo helper que usa el tablero de terminal
(`helperExe` y `server` salen del `kit.config.json`). Hay dos trabajos:

- **Asuntos de commits**: se juntan los que todavía no tienen traducción en un
  solo pedido numerado (hasta 40 líneas) y la respuesta se guarda por SHA en
  `translations.json`, así cada commit se traduce una sola vez. El prefijo
  `tipo(alcance):` de Conventional Commits y los nombres de código, rutas,
  comandos e IDs se conservan tal cual; si el modelo los pierde, el servicio
  restaura el prefijo original. El asunto en inglés queda en el tooltip.
- **Resumen de actividad**: cada pista que está trabajando recibe cada ~2
  minutos como máximo un resumen de una línea (≤ 120 caracteres) de sus últimos
  ~20 eventos. Se cachea por pista y firma de actividad, así que mientras no
  cambie la actividad no se pide de nuevo.

Nada de esto bloquea la página: primero se muestra el texto en inglés y cuando
la traducción llega aparece en el siguiente refresco. Hay como mucho **un
pedido en vuelo**; si el helper falla, se mantiene el inglés y se reintenta con
espera exponencial (de 1 a 15 minutos). El modelo se cambia con
`translate.model` (`opencode-go/space-bunny-free` por defecto) y todo se apaga
con `translate.enabled: false`.

## Pistas de Antigravity

Para registrar un trabajador de Antigravity, la pista en `kit.config.json` debe definir `engine: "antigravity"`, el `model` y `activityFile` apuntando al archivo NDJSON generado. El patrón de lanzamiento desde el directorio de trabajo del constructor es:

```powershell
agy -p "<brief>" --model "Gemini 3.1 Pro (High)" --output-format stream-json > <activityFile>
```

`agy` toma como espacio de trabajo la carpeta desde donde se lanza (no tiene
`--cwd`). Para que pueda editar sin quedar bloqueado, agregá `--mode accept-edits`.
En modo sin interfaz, cualquier permiso denegado corta el turno y aun así
informa `SUCCESS` con respuesta vacía: la tarjeta lo muestra como `ERR`
(`permiso denegado: ...` o `terminó sin respuesta`).

## Configuración

Todo vive en `fleet-monitor.config.json` (comentado en
`fleet-monitor.config.example.json`, con Codex como orquestador). Las rutas
relativas se resuelven contra la carpeta del archivo; se expanden `%VARIABLES%`
y `~`. Claves:

| Clave | Qué es |
| --- | --- |
| `server.host` / `server.port` | Dirección y puerto; solo se acepta loopback (4200 por defecto). |
| `orchestrator.engine` | `claude-code`, `codex`, `opencode` o `antigravity`. |
| `orchestrator.model` / `effort` / `label` | Modelo, nivel de esfuerzo y nombre visible del orquestador (`label` va en el tooltip). |
| `workers.kitConfig` | Ruta al `kit.config.json` del kit; de ahí salen las pistas, el repo y el servidor de OpenCode. |
| `claude.usageFile` | `claude-usage.json` (opcional). |
| `codex.sessionsDir` | Carpeta de rollouts de Codex (`%USERPROFILE%\.codex\sessions`). |
| `opencode.officialFile` | `opencode-official.json` (opcional, gana). |
| `opencode.accountFile` | `opencode-account.json` (opcional, cambio de cuenta). |
| `opencode.estimateScript` | `opencode-usage.mjs` del kit (respaldo y delta local). |
| `repo` | Repositorio para el árbol de git y el último commit; si falta, se usa el del kit. |
| `projects` | Lista opcional de proyectos vigilados (`id`, `name`, `repo`, `kitConfig`); sin ella queda el proyecto implícito de `repo` + `workers.kitConfig`. |
| `translate.enabled` | `false` apaga las traducciones y los resúmenes (por defecto, encendidos). |
| `translate.model` | Modelo del helper (`opencode-go/space-bunny-free` por defecto). |
| `translate.summarySeconds` | Mínimo entre resúmenes por pista (120 s por defecto). |
| `cleanup.hideFinishedAfterMinutes` | Minutos de antigüedad a partir de los cuales se ocultan las tarjetas `terminado` o `detenido` (`5` por defecto); `0` o la clave ausente desactivan la limpieza. |
| `pollSeconds` / `*CacheSeconds` | Cadencia de la página y cachés del servidor. |

Con `cleanup.hideFinishedAfterMinutes` en un valor mayor que 0 (`5` por defecto),
las tarjetas `terminado` o `detenido` cuyo último estado supere esa antigüedad
se dejan fuera del tablero y el encabezado de agentes indica cuántas quedaron
ocultas con un botón discreto (por ejemplo, `· 4 activos / 7 en total · 3
terminadas ocultas`). Al hacer clic (o activarlo con el teclado) el botón muestra
esas tarjetas después de las visibles, atenuadas y con la marca `oculta`, y
cambia su texto a `ocultar N terminadas`; la elección se recuerda en la página y
sobrevive a los refrescos de 5 segundos. El presupuesto de líneas de actividad
usa solo las tarjetas visibles y pasa al total cuando las ocultas se muestran.
Las pistas trabajando, esperando o sin reporte reciente nunca se ocultan, y una
tarjeta sin archivo de estado o sin hora válida tampoco. Con `0` o sin la clave,
el tablero se muestra completo, como hasta ahora.

## Varios proyectos

La configuración acepta una lista opcional `projects` para vigilar varios
proyectos y cambiar entre ellos desde el encabezado:

```json
"projects": [
  { "id": "korsakov", "name": "Korsakov Orchestrator", "repo": "../..", "kitConfig": "../autopilot/kit.config.json" }
]
```

Cada entrada lleva `id`, `name`, `repo` y `kitConfig`; las rutas se resuelven
igual que `repo` y `workers.kitConfig` (contra la carpeta del archivo, con
`%VARIABLES%` y `~`), y `name` cae al nombre de la carpeta del repo. Sin
`projects`, todo sigue como antes: un único proyecto implícito (`id`
`default`, nombre = carpeta del repo) armado con el `repo` y el
`workers.kitConfig` de arriba.

En el encabezado hay un selector con los proyectos. La elección viaja como
`?project=<id>` en cada consulta, queda en la URL de la página y se recuerda en
`localStorage`; al cargar gana la URL, después `localStorage`, y si el id ya no
existe se usa el primero. La API suma `GET /api/projects`
(`{ "projects": [{ "id", "name" }], "defaultId": "<primero>" }`) y
`GET /api/state?project=<id>` (sin el parámetro, el primero; id desconocido →
404 con `{ "error": "unknown project" }`). La foto incluye
`project: { id, name }`. El consumo, el estado del PC y los datos del
orquestador son globales y se comparten entre proyectos; el árbol de git, las
pistas, el kit y sus cachés son de cada proyecto.

Agregar un motor nuevo es agregar un adaptador en `adapters/` con `usage()` y
`activity()`, sin tocar la página.

## Controles

```powershell
node --check server.mjs
node --test
```

Desde la raíz del repositorio: `node --test "tools/fleet-monitor/test/**/*.test.mjs"`.

La carpeta `test/` tiene las pruebas de las partes puras (cuenta regresiva,
estados, límites de Codex, mapeo de eventos de OpenCode, antigüedad del consumo
de Claude, asignación de carriles y colores de rama del grafo, la etiqueta del
orquestador, decisión panel/tarjeta del árbol de git con sus umbrales e
histéresis, loteo/caché/backoff de las traducciones y una comprobación de la
estructura de la página) con archivos de ejemplo en `test/fixtures/`. Las pruebas de traducción usan un runner simulado:
nunca llaman al modelo real.

## Límites conocidos

- El árbol de git carga los últimos 200 commits de `git log --all --date-order`;
  lo que quede fuera de ese rango no aparece. El panel tiene scroll propio
  para recorrerlos.
- La página nunca hace scroll (solo el scroll propio del árbol): si hay
  demasiadas pistas para el alto de la ventana, las tarjetas recortan sus líneas
  de actividad (8/4/2) y el árbol pasa a ser una tarjeta de la grilla (ver el
  punto 4).
- La actividad de subagentes de Claude Code sale de la transcripción JSONL que
  la pista declare en `activityFile`; sin ese campo, o si el archivo no se
  puede leer, la tarjeta informa "sin actividad visible". El adaptador lee solo
  la cola del archivo (200 líneas, máximo 512 KB) y descarta sin romper el
  servidor las líneas malformadas.
- Los eventos del log de Codex no traen marca de tiempo propia: se usa la hora
  de última escritura del archivo.
- El consumo de OpenCode Go es una estimación local salvo que exista
  `opencode-official.json`; la fuente válida es la consola de opencode.ai.
  Cuando solo hay estimación, ese renglón no muestra antigüedad (no hay
  snapshot que fechar). La antigüedad de Codex sale del timestamp del evento
  `rate_limits` del rollout.
- La línea del PC usa WMI vía PowerShell; si falla, la RAM se calcula con
  `node:os` y el resto queda sin dato.
- Sin helper o sin servidor de OpenCode, las traducciones y los resúmenes no se
  generan: la página sigue mostrando todo en inglés (o los datos crudos) y no
  se agrega ningún aviso. Las traducciones nuevas pueden tardar uno o dos
  refrescos en aparecer.
- El servidor no se registra para arrancar con Windows; para eso, crear un
  acceso directo a `start.ps1`.
