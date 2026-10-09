# Korsakov Orchestrator

Herramienta local para orquestar agentes de IA de distintos proveedores desde un solo lugar, por proyecto, con visibilidad en vivo y control de cuotas. El equipo de agentes que cubre hoy es Claude Code (orquestador), y OpenCode, Codex y Antigravity (trabajadores).

Lo que existe hoy es el **monitor** (`monitor/`): un panel web local, de solo lectura, sin dependencias npm, que muestra qué está haciendo cada agente, el árbol de git y el consumo de cuotas. Además, `claude-mods/` incluye dos mods para Claude Code que lo integran con el monitor. El chat y el selector de orquestador siguen en el plan (ver [docs/arquitectura-y-plan.md](docs/arquitectura-y-plan.md)).

## Qué hace

El monitor es una sola pantalla sin scroll, que se refresca cada 5 segundos:

- **Consumo y cuotas**: medidores de 5 horas y semanales de Claude, Codex y OpenCode Go, con semáforo (verde, ámbar desde 70 %, rojo desde 90 %) y antigüedad del dato. Ocultos por defecto (`ui.showUsage`).
- **Estado del PC**: CPU, RAM y disco C: con semáforo (`ui.showPc`).
- **Tablero de agentes**: una tarjeta por pista con estado (trabajando, terminado, detenido, esperando), modelo y esfuerzo, cuenta regresiva, últimas líneas de actividad, barra de avance de la lista de tareas y resumen corto de lo que hace.
- **Visor en vivo**: reproduce paso a paso lo que hizo el agente (archivos, comandos, memoria, herramientas, razonamiento) con pestañas por elemento y animación de tipeo simulada.
- **Árbol de git**: grafo SVG animado con carriles por rama, de los últimos 200 commits; pasa a ser una tarjeta de la grilla cuando falta espacio.
- **Varios proyectos**: selector en el encabezado y parámetro `?project=<id>` en la URL.
- **Temas**: `matrix`, `claude-desktop`, `bash`, `jarvis`, `naruto` y `vscode`, con selector `TEMA` e interruptor `FONDO` para el fondo animado.
- **Traducción de la vista**: los asuntos de commits y los resúmenes de actividad se muestran en español mediante un modelo gratuito de OpenCode (se apaga con `translate.enabled: false`).
- **Archivos de los agentes**: la página puede servir imágenes, video, audio y PDF producidos por un agente, y abrirlos en el Explorador, siempre dentro de su carpeta de trabajo.

El servidor escucha solo en `127.0.0.1` y no escribe en los proyectos vigilados.

## Estructura del repositorio

| Carpeta | Contenido |
| --- | --- |
| [`monitor/`](monitor/) | La aplicación: `server.mjs`, `index.html`, adaptadores por motor (`adapters/`), lógica pura (`lib/`), recursos (`public/`), pruebas (`test/`) y los scripts `start.ps1` y `supervise.ps1`. |
| [`docs/`](docs/) | Decisiones, arquitectura y plan, cuotas, modelos y ruteo, temas, vista en vivo, estado actual, pendientes e informes de investigación. |
| [`odd/`](odd/) | Documentos de tareas por funcionalidad (`odd/tasks/`) y briefs de trabajo. |
| [`claude-mods/`](claude-mods/) | Mods (plugins) de Claude Code: `quota-band` y `monitor-autoopen`. |

La carpeta `.korsakov/` guarda estado local de cada máquina (configuraciones del kit, briefs, logs) y está en `.gitignore`; no se versiona. Tampoco se versionan `monitor/fleet-monitor.config.json`, `monitor/translations.json` ni los logs del supervisor.

## Requisitos

- Windows con PowerShell (los scripts de arranque usan `powershell.exe` y WMI).
- Node.js 24 (el monitor usa solo módulos integrados; no hay `npm install`).
- `git` en el PATH para el árbol de commits.
- Opcional: OpenCode para las traducciones y resúmenes en español.

## Instalación y configuración

1. Copiar el ejemplo de configuración junto a `server.mjs`:

   ```powershell
   Copy-Item monitor\fleet-monitor.config.example.json monitor\fleet-monitor.config.json
   ```

2. Editar `monitor/fleet-monitor.config.json` con las rutas de la máquina. Las rutas relativas se resuelven contra la carpeta del archivo y se expanden `%VARIABLES%` y `~`.

3. Declarar los proyectos vigilados en el arreglo `projects`:

   ```json
   "projects": [
     { "id": "korsakov", "name": "Korsakov Orchestrator", "repo": "../..", "kitConfig": "../autopilot/kit.config.json" }
   ]
   ```

   Sin `projects` queda un único proyecto implícito (`id` `default`) armado con `repo` y `workers.kitConfig`.

Claves principales (el detalle completo está en [monitor/README.md](monitor/README.md#configuración)):

| Clave | Qué es |
| --- | --- |
| `server.host` / `server.port` | Dirección y puerto; solo se acepta loopback (4200 por defecto). |
| `orchestrator.engine` / `model` / `effort` / `label` | Motor (`claude-code`, `codex`, `opencode`, `antigravity`) y datos que se muestran del orquestador. |
| `workers.kitConfig` | `kit.config.json` del kit de autopiloto, de donde salen las pistas. |
| `claude.usageFile`, `codex.sessionsDir`, `opencode.*` | Orígenes de los datos de consumo. |
| `translate.enabled` / `translate.model` | Traducción de la vista al español. |
| `cleanup.hideFinishedAfterMinutes` | Oculta tarjetas terminadas o detenidas tras N minutos. |
| `discoverClaudeProjects`, `claudeSubagents`, `opencodeDiscovery`, `codexDiscovery` | Descubrimiento de proyectos y sesiones. |
| `ui.showUsage` / `ui.showPc` | Muestran los medidores de consumo y la carga del PC. |

La configuración se relee en cada consulta: editarla no requiere reiniciar el servidor.

## Uso

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File monitor/start.ps1 [-ConfigPath <ruta>] [-Port 4200] [-NoBrowser]
```

Abre `http://127.0.0.1:4200/`. El script es idempotente: si el monitor ya está corriendo, solo vuelve a abrir la página. El servidor corre desacoplado de la terminal, bajo `supervise.ps1`, que guarda los logs (`monitor/monitor.*.log`) y lo reinicia si se cae. Para reiniciarlo tras un cambio de código, basta con detener el proceso `node`: el supervisor lo levanta de nuevo en un par de segundos.

Para correrlo a mano, sin supervisor:

```powershell
node monitor/server.mjs
```

Pruebas y verificación de sintaxis, desde `monitor/`:

```powershell
node --check server.mjs
node --test
```

El servidor no se registra para arrancar con Windows; para eso se puede crear un acceso directo a `start.ps1`.

## Mods de Claude Code (`claude-mods/`)

Son plugins de Claude Code (hooks escritos en TypeScript que se recargan en caliente) que conectan la sesión con el monitor.

### `quota-band`

Muestra encima del prompt una banda con:

- **CPU, RAM y Disk C:** con el valor coloreado por nivel; desde 50 % la etiqueta y el valor se resaltan, y los valores críticos parpadean.
- **Cuota de 5 horas y semanal** de Claude, Codex y OpenCode, con barra y porcentajes. El dato de Claude llega con cada respuesta de la sesión; el de Codex sale de los rollouts de `%USERPROFILE%\.codex\sessions` o de `codex-usage.json`; el de OpenCode, de `opencode-official.json`. Antigravity figura en el código pero no tiene fuente local de cuota, por lo que no muestra barras.
- Se refresca cada 60 s (cuotas) y 15 s (PC). El comando `quota-band` muestra u oculta la banda.

Lee los snapshots de cuota desde `%USERPROFILE%\.claude\quota\` y ejecuta `codex-quota.mjs` y `opencode-quota.mjs` desde esa carpeta si existen (hay una versión de `opencode-quota.mjs` en [docs/scripts/](docs/scripts/)).

### `monitor-autoopen`

En cada inicio de sesión (hook `session.start`) consulta `http://127.0.0.1:4200/api/projects`:

1. Si el monitor no está corriendo, no hace nada.
2. Si está corriendo, elige el proyecto cuyo `name` coincide (sin distinguir mayúsculas) con el nombre de la carpeta de la sesión y abre `http://127.0.0.1:4200/?project=<id>` en el navegador integrado de Claude Desktop, mediante el servidor MCP `Claude_Browser` (`preview_start`). Si ningún proyecto coincide, abre la página sin filtro.
3. Reintenta cada 2 s hasta 30 veces, porque el servidor del navegador se conecta después de que arranca la sesión.
4. Después vigila durante 2 minutos (cada 5 s) y reabre la pestaña si el escritorio la reinició.

Es código puro del motor: no consume tokens del modelo. Escribe sus diagnósticos en `runs.log`, dentro de la carpeta del mod.

**Limitación conocida (verificada):** Claude Desktop mantiene el panel del navegador oculto. La página queda precargada con el proyecto correcto y se muestra con un clic en el ícono del globo; hoy no hay una API que muestre el panel automáticamente.

**Consejo de coincidencia:** asignar a cada proyecto de `fleet-monitor.config.json` un `name` igual al nombre de su carpeta, para que se seleccione el proyecto correcto.

### Configuración para que se abra en el navegador de cualquier sesión, respetando el proyecto

1. Copiar cada carpeta de mod a `%USERPROFILE%\.claude\mods\<mod>` (o referenciar directamente la ruta dentro del repositorio).
2. Agregar las rutas a `env.CLAUDE_CODE_PLUGIN_DIRS` en `%USERPROFILE%\.claude\settings.json`, separadas por `;` en Windows:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<usuario>\\.claude\\mods\\quota-band;C:\\Users\\<usuario>\\.claude\\mods\\monitor-autoopen"
     }
   }
   ```

3. Integrar esto en el `settings.json` existente (no reemplazarlo). Las sesiones nuevas cargan los mods; las que ya estaban abiertas, no.
4. Verificar cada mod con `claude plugin validate <carpeta-del-mod>`.
5. Para desinstalar, quitar la ruta de la variable.

El ajuste de Claude Desktop "Abrir enlaces en el navegador integrado" es opcional.

## Documentación

- [monitor/README.md](monitor/README.md): referencia completa del monitor (pantalla, visor en vivo, API, configuración, límites conocidos).
- [docs/README.md](docs/README.md): índice de la documentación.
- [docs/decisiones.md](docs/decisiones.md): lo decidido, con el porqué y lo descartado.
- [docs/arquitectura-y-plan.md](docs/arquitectura-y-plan.md): cómo se construye y en qué etapas.
- [docs/temas.md](docs/temas.md): requisitos de los temas visuales.
- [docs/vista-en-vivo.md](docs/vista-en-vivo.md): requisitos de la vista en vivo de la actividad.
- [docs/estado-actual.md](docs/estado-actual.md) y [docs/huecos-y-pendientes.md](docs/huecos-y-pendientes.md): qué existe hoy y qué falta.
- [odd/tasks/](odd/tasks/): documentos de tareas por funcionalidad.
