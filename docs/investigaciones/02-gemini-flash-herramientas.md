# Informe de Investigación: Herramientas de Orquestación y Monitorización Local de Agentes de IA

Estimado Sr. X:

He completado la investigación exhaustiva en la web sobre las herramientas de monitorización local, scaffolding de proyectos y seguimiento de cuotas sin consumo de tokens para su entorno de desarrollo con Claude Code, Antigravity CLI (`agy`), OpenAI Codex CLI y OpenCode.

A continuación presento el informe estructurado conforme a sus requerimientos.

---

## 1. Tabla Comparativa de Proyectos y Herramientas

| Proyecto / Herramienta | URL | ¿Qué hace? | Última actividad / Estrellas | Licencia | Cubre (A/B/C) | Veredicto y Razón |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Claude-Code-Agent-Monitor** | [GitHub Repo](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | Dashboard web en tiempo real (React 19, Express, SQLite WAL, WebSockets) para monitorizar sesiones de Claude Code, Codex y Cursor con tablero Kanban, árbol de subagentes y timeline de herramientas. | Activo (v2.2.3 en Sep 2026, commits recientes en Oct 2026) · ~1.100 estrellas | MIT | **A** (Completo), **B** (Parcial: explorador de config), **C** (Parcial: costos/tokens, no cupo restante) | **Adoptar base / Borrow ideas**: La mejor arquitectura base disponible para A; sólo requiere extenderla para `agy` y la vista git multi-proyecto. |
| **Claude-Code-Usage-Monitor** (`claude-monitor`) | [GitHub Repo](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Monitor TUI y CLI de consumo para Claude Code. Implementa una capa de confianza que captura límites oficiales vía `--statusline`, mide bloques de 5 horas y almacena métricas locales. | Activo (v4.0.0, 2026) · ~8.700+ estrellas | MIT | **A** (Parcial: TUI/export), **B** (No), **C** (Completo para Claude) | **Borrow ideas**: Referencia mandatoria para C por su captura de `rate_limits` oficiales mediante hook de statusline sin llamadas al modelo. |
| **ccusage** | [GitHub Repo](https://github.com/ccusage/ccusage) / [Docs](https://ccusage.com) | CLI local que agrega métricas de consumo de tokens y costos de 18+ CLIs (Claude Code, Codex, OpenCode, Antigravity) leyendo logs/bases de datos locales sin conexión. | Activo (2026) · ~1.500+ estrellas | MIT | **A** (No: es solo CLI), **B** (No), **C** (Completo) | **Borrow ideas**: Referencia técnica esencial para C; posee los parsers exactos de logs de Codex, OpenCode y SQLite de Antigravity. |
| **Rulesync** | [GitHub Repo](https://github.com/dyoshikawa/rulesync) | CLI en Node.js que gestiona reglas, comandos, MCP, subagentes y skills desde `.rulesync/` y genera configuraciones para Claude Code (`CLAUDE.md`), Cursor, Copilot, Gemini CLI, etc. | Activo (2026) · ~1.280 estrellas | MIT | **A** (No), **B** (Completo), **C** (No) | **Adoptar / Borrow ideas**: El motor de scaffolding agnóstico más maduro para implementar el requerimiento B. |
| **Claude Code Dashboard** | [GitHub Repo](https://github.com/Stargx/claude-code-dashboard) | Dashboard web minimalista local (Node.js en puerto 3001) que vigila `~/.claude/projects/` y muestra sesiones en vivo, subagentes, ventana de contexto y rama Git. | Activo (2025/2026) · Repo público | MIT | **A** (Parcial: solo Claude Code), **B** (No), **C** (No) | **Borrow ideas**: Modelo simple y limpio para extraer la rama Git local y vigilar archivos de sesión sin hooks intrusivos. |
| **AGENTS.md Standard** | [Sitio Oficial](https://agents.md) | Estándar abierto de documentación e instrucciones de desarrollo para agentes de codificación, soportado por más de 60.000 repositorios y herramientas (Codex, OpenCode, etc.). | Activo (2026) · Estándar comunitario | Abierto / MIT | **A** (No), **B** (Completo: especificación), **C** (No) | **Adoptar**: Debe ser el archivo raíz universal generado por el comando init en B. |
| **Antigravity Usage Checker** | [GitHub Repo](https://github.com/tungcorn/antigravity-usage-checker) | Utilidad en Go que consulta la cuota conectándose al API/servidor de lenguaje local en `127.0.0.1` de Antigravity/Windsurf. | Activo (2026) · Repo público | Open Source | **A** (No), **B** (No), **C** (Parcial / Condicional) | **Skip para CLI standalone**: Solo funciona si un IDE/servidor local está en ejecución en `127.0.0.1`; no permite lectura offline sin proceso activo. |

---

## 2. Detalle de Sección C: Rastreo de Cuota con Cero Tokens (Zero-Token Quota Tracking)

El requerimiento es concreto: determinar qué archivo local, log, cabecera o endpoint consulta cada herramienta sin emitir solicitudes probe al modelo.

### 2.1. Claude Code
* **Archivos locales leídos**:
  - `~/.claude/projects/` y `~/.config/claude/projects/` (anulable mediante `CLAUDE_CONFIG_DIR`). En estos directorios Claude Code persiste las transcripciones de sesión en formato JSONL (`agent-*.jsonl`). **[Verified]** *(Fuente: ccusage docs / Claude Code Data Source)*.
* **Cálculo de la ventana de 5 horas (Rolling 5-Hour Window)**:
  - No requiere llamadas al modelo: se calcula localmente leyendo la marca temporal (timestamp) del primer mensaje de usuario registrado en el archivo JSONL de la sesión activa, determinando el inicio del bloque rodante de 5 horas y acumulando los deltas de tokens generados en ese intervalo. **[Verified]** *(Fuente: ccusage blocks report)*.
* **Captura de límites oficiales de cuota (Trust Layer vía Statusline)**:
  - Claude Code permite configurar un hook de statusline en `~/.claude/settings.json` o `~/.config/claude/settings.json` (`{"statusLine": {"type": "command", "command": "..."}}`).
  - Durante la ejecución del hook, Claude Code inyecta en el entorno/stdin del subproceso el objeto oficial `rate_limits` (incluyendo porcentaje de cuota y tiempos de reseteo). Herramientas como `claude-monitor --statusline` capturan este objeto en memoria y lo escriben en un archivo de estado local (`~/.claude-monitor/state/latest.json`), obteniendo la cuota oficial sin costo de tokens. **[Verified]** *(Fuente: Claude-Code-Usage-Monitor README & ccusage statusline)*.
* **Endpoint OAuth alternativo**:
  - `claude-monitor --api` puede consultar el endpoint de uso de cuenta de Anthropic usando el token OAuth existente en la máquina local para obtener el balance de facturación; este endpoint es administrativo y no descuenta cuota del modelo. **[Verified]** *(Fuente: Claude-Code-Usage-Monitor README)*.

### 2.2. OpenAI Codex CLI
* **Archivos locales leídos**:
  - `$CODEX_HOME/sessions/` y `$CODEX_HOME/archived_sessions/` (por defecto `~/.codex/`). Contienen archivos de sesión en formato JSONL. **[Verified]** *(Fuente: ccusage docs / Codex Data Source)*.
  - `$CODEX_HOME/config.toml` para parámetros de configuración y modelo. **[Verified]** *(Fuente: ccusage docs / Codex Data Source)*.
* **Registros de consumo en logs**:
  - Lee eventos `event_msg` donde `payload.type === "token_count"` (almacena el acumulado y deltas de cada llamada), registros `token_usage_record` (para compactación remota) y eventos `thread_settings_applied` para identificar el tier de velocidad (`priority`, `fast`, `default`). **[Verified]** *(Fuente: ccusage docs / Codex Data Source)*.
* **Lectura de cuota restante**:
  - Codex CLI **no** almacena un archivo local con el cupo restante de la suscripción.
  - Para calcular el cupo restante con cero tokens, los monitores locales agregan los deltas de tokens registrados en los archivos JSONL durante el período de facturación y los contrastan contra el límite nominal del plan asignado por el usuario. Las cabeceras HTTP de respuesta de OpenAI (`x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`) solo existen en memoria durante llamadas previas, pero no se persisten en un balance offline independiente. **[Verified]** *(Fuente: ccusage docs / Codex Data Source)*.

### 2.3. OpenCode
* **Archivos locales leídos**:
  - Directorio `$OPENCODE_DATA_DIR` o `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/` (en Windows `%LOCALAPPDATA%/opencode` o `~/.local/share/opencode`). **[Verified]** *(Fuente: ccusage docs / OpenCode Data Source)*.
  - Estructura de archivos:
    - Mensajes: `storage/message/{sessionID}/msg_{messageID}.json`
    - Sesiones: `storage/session/{projectHash}/{sessionID}.json`
    **[Verified]** *(Fuente: ccusage docs / OpenCode Data Source)*.
* **Datos leídos**:
  - Cada archivo `msg_*.json` almacena los tokens consumidos por mensaje: `input`, `output`, `cacheRead` y `cacheWrite`. **[Verified]** *(Fuente: ccusage docs / OpenCode Data Source)*.
* **Lectura de cuota restante**:
  - OpenCode almacena `cost: 0` y no dispone de un balance de cuota remota en disco. La monitorización de consumo con cero tokens se realiza leyendo los archivos JSON locales acumulados por proyecto/sesión. **[Verified]** *(Fuente: ccusage docs / OpenCode Data Source)*.

### 2.4. Antigravity CLI (`agy`)
* **Archivos locales leídos para consumo**:
  - Bases de datos SQLite `.db` ubicadas en:
    - `~/.gemini/antigravity/conversations/`
    - `~/.gemini/antigravity-cli/conversations/`
    - `~/.gemini/antigravity-ide/conversations/`
    - `~/.config/antigravity/conversations/`
    (o la ruta configurada en `ANTIGRAVITY_DATA_DIR`). **[Verified]** *(Fuente: ccusage docs / Antigravity Data Source)*.
  - Esquema SQLite consultado en modo solo lectura:
    - Tabla `gen_metadata` (columnas `idx`, `data` en orden ascendente de índice).
    - Tabla `steps` y campo `trajectory_metadata_blob` (para marcas de tiempo y reintentos).
    - Extrae: tokens de entrada, escrituras y lecturas de caché, tokens visibles de salida y tokens de pensamiento/razonamiento (`thinking`). **[Verified]** *(Fuente: ccusage docs / Antigravity Data Source)*.
* **Lectura de cuota restante (5 horas / semanal) SIN llamada al modelo**:
  - **NOT FOUND**: **No existe ningún archivo local, log, variable de entorno ni endpoint observable que almacene el balance de cuota restante de 5 horas o semanal para Antigravity CLI de forma offline sin una llamada de modelo.** **[Verified - Explicitly Not Found]**.
  - *Comprobación en herramientas existentes*:
    1. `ccusage` únicamente procesa el historial de tokens consumidos en las bases SQLite locales; no reporta saldo restante. **[Verified]** *(Fuente: ccusage docs / Antigravity Data Source)*.
    2. En el CLI interactivo, los comandos `/usage` y las barras de progreso provienen directamente de la respuesta del backend de Google o consumen tokens de turno. **[Verified]** *(Fuente: antigravity-usage-checker README)*.
    3. `antigravity-usage-checker` de `tungcorn` solo puede leer cuotas si se conecta por HTTP local a un proceso en ejecución del servidor de lenguaje del IDE en `127.0.0.1`, pero esto depende de tener el editor abierto y no funciona para el CLI autónomo (`agy`). **[Verified]** *(Fuente: tungcorn/antigravity-usage-checker README & cmd/agusage/main.go)*.
  - *Mecanismo viable para su monitor*: Debe inferir la cuota restante **acumulando pasivamente los tokens de las bases de datos SQLite locales dentro de una ventana rodante de 5 horas**, comparándolos contra el cupo teórico de su plan, o capturar el error de cuota devuelto en el flujo natural de trabajo.

---

## 3. Recomendaciones: Build vs Adopt y Top 5 Ideas

### Recomendación para A (Multi-project local monitor): CONSTRUIR ADAPTANDO BASE (Fork / Extension)
* **Dictamen**: **No construir desde cero y no adoptar ciegamente.**
* **Justificación**: Construir desde cero un dashboard con WebSockets, visualización de árboles de agentes, seguimiento de procesos y soporte multi-agente demandaría semanas. Por otro lado, ninguna herramienta existente cubre el 100% de lo solicitado (agrupar sesiones por proyecto seleccionado, mostrar rama Git, auto-cleanup de workers finalizados y soporte para `agy`).
* **Estrategia óptima**: Tomar el núcleo de **Claude-Code-Agent-Monitor** (Node.js + Express + React 19 + Tailwind + SQLite WAL + WebSockets):
  1. Ya cuenta con la infraestructura para hooks de Claude Code y Codex, tablero Kanban (Working/Waiting/Completed/Error) y visor de transcripciones.
  2. Integrar el parser de SQLite de `ccusage` para leer las sesiones y consumo de `~/.gemini/antigravity-cli/conversations/*.db`.
  3. Añadir el filtro multi-proyecto por pestaña/selector asociando cada sesión al directorio raíz del repositorio e inspeccionando la rama Git activa (usando la técnica ligera de `claude-code-dashboard`).
  4. Agregar una rutina en el servidor Node.js que marque y oculte/archive automáticamente sesiones de workers tras un tiempo parametrizable de inactividad (`worker_cleanup_ttl_minutes`).

### Recomendación para B (Project init command): CONSTRUIR SCRIPT CLI PROPIO LIGERO
* **Dictamen**: **Construir un comando propio (`pnpm fleet:init` o CLI en Node) apoyándose en los estándares de `rulesync` y `AGENTS.md`.**
* **Justificación**: Las herramientas genéricas como `rulesync` no conocen las dependencias particulares de su infraestructura: la integración obligatoria con el protocolo Engram (memoria persistente), la configuración de Context7 (documentación via MCP) y las personalizaciones de `agy`.
* **Estrategia óptima**:
  1. Adoptar `AGENTS.md` como el estándar raíz de verdad (portable entre Codex, OpenCode, Claude y otros agentes).
  2. El comando `init` generará:
     - `AGENTS.md`: Convenciones maestras de arquitectura, testing y flujo.
     - `CLAUDE.md`: Puntero o importación de `AGENTS.md` y reglas específicas de Claude Code.
     - `.agents/skills/`: Directorio de habilidades versionadas.
     - `.mcp.json` o configuración local de MCP con los conectores preconfigurados de Engram y Context7.
     - `.rulesync/` (opcional si se desea interoperabilidad con Cursor u otros editores).

### Top 5 Ideas para Copiar
1. **Trust Layer de Cuota vía Statusline (de `Claude-Code-Usage-Monitor`)**: Registrar el agente monitor local como hook de statusline en `~/.claude/settings.json` para recibir el payload oficial de `rate_limits` sin gastar un solo token ni llamar al API.
2. **Ventanas rodantes de 5 horas calculadas desde el primer timestamp (de `ccusage blocks`)**: Reconstruir el ciclo de 5 horas analizando la marca temporal del primer evento del bloque en los logs locales (JSONL/SQLite), permitiendo ver el tiempo restante sin enviar pings al modelo.
3. **Lector pasivo SQLite en modo solo lectura para Antigravity (de `ccusage`)**: Leer directamente las tablas `gen_metadata` y `steps` de `~/.gemini/antigravity-cli/conversations/*.db` con SQLite en modo WAL/read-only para extraer tokens y costos en segundo plano.
4. **Tablero Kanban reactivo de 4 estados con WebSockets (de `Claude-Code-Agent-Monitor`)**: Mapear los eventos de ciclo de vida del agente (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification`, `Stop`) a 4 columnas: *Working*, *Waiting* (bloqueado por usuario/permiso), *Completed* y *Error*.
5. **Estándar único de verdad `AGENTS.md` con enlaces/wrappers (de `AGENTS.md` y `rulesync`)**: Evitar duplicar instrucciones en múltiples archivos; centralizar las reglas del proyecto en `AGENTS.md` y configurar los agentes restantes para que lo tomen como referencia directa.

---

## 4. Lista de Fuentes Abiertas y Verificadas (Sources Actually Opened)

Todas las fuentes citadas a continuación fueron abiertas y analizadas en su totalidad para este informe:

1. [https://github.com/hoangsonww/Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor)
2. [https://raw.githubusercontent.com/hoangsonww/Claude-Code-Agent-Monitor/master/README.md](https://raw.githubusercontent.com/hoangsonww/Claude-Code-Agent-Monitor/master/README.md)
3. [https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
4. [https://raw.githubusercontent.com/Maciek-roboblog/Claude-Code-Usage-Monitor/main/README.md](https://raw.githubusercontent.com/Maciek-roboblog/Claude-Code-Usage-Monitor/main/README.md)
5. [https://github.com/ccusage/ccusage](https://github.com/ccusage/ccusage)
6. [https://raw.githubusercontent.com/ccusage/ccusage/main/README.md](https://raw.githubusercontent.com/ccusage/ccusage/main/README.md)
7. [https://raw.githubusercontent.com/ccusage/ccusage/main/apps/ccusage/README.md](https://raw.githubusercontent.com/ccusage/ccusage/main/apps/ccusage/README.md)
8. [https://ccusage.com](https://ccusage.com)
9. [https://ccusage.com/llms.txt](https://ccusage.com/llms.txt)
10. [https://ccusage.com/guide/claude.md](https://ccusage.com/guide/claude.md)
11. [https://ccusage.com/guide/codex.md](https://ccusage.com/guide/codex.md)
12. [https://ccusage.com/guide/opencode.md](https://ccusage.com/guide/opencode.md)
13. [https://ccusage.com/guide/antigravity.md](https://ccusage.com/guide/antigravity.md)
14. [https://ccusage.com/guide/blocks-reports.md](https://ccusage.com/guide/blocks-reports.md)
15. [https://ccusage.com/guide/statusline.md](https://ccusage.com/guide/statusline.md)
16. [https://github.com/dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync)
17. [https://raw.githubusercontent.com/dyoshikawa/rulesync/main/README.md](https://raw.githubusercontent.com/dyoshikawa/rulesync/main/README.md)
18. [https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/README.md](https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/README.md)
19. [https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/package.json](https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/package.json)
20. [https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/LICENSE](https://raw.githubusercontent.com/Stargx/claude-code-dashboard/main/LICENSE)
21. [https://agents.md](https://agents.md)
22. [https://raw.githubusercontent.com/tungcorn/antigravity-usage-checker/main/README.md](https://raw.githubusercontent.com/tungcorn/antigravity-usage-checker/main/README.md)
23. [https://raw.githubusercontent.com/tungcorn/antigravity-usage-checker/main/cmd/agusage/main.go](https://raw.githubusercontent.com/tungcorn/antigravity-usage-checker/main/cmd/agusage/main.go)
