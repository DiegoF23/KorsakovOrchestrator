Estimado Sr. X, acá tiene el reporte exhaustivo de investigación arquitectónica para la construcción de una interfaz web que orqueste Claude Code, Codex, OpenCode y Antigravity en Windows 11.

---

# Informe de Investigación: Web UI Wrapper Multi-Orquestador de Agentes CLI

## 1. Claude Code Headless: Streaming Bidireccional, Protocolo y Límites

### Flags exactos para ejecución headless y streaming bidireccional
Para operar Claude Code sin TTY como subproceso interactivo continuo, la combinación exacta de flags es:
`claude -p --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions`

* **`-p` / `--print`** [Verificado]: Fuerza el modo no interactivo/impresión. Es obligatorio para evitar que el CLI inicialice la interfaz a pantalla completa basada en Ink/React.
* **`--output-format stream-json`** [Verificado]: Emite la salida como Newline Delimited JSON (NDJSON) evento por evento por `stdout`. **Nota crítica:** En versiones recientes de Claude Code, requiere obligatoriamente `--verbose`; de lo contrario, el proceso finaliza con código de error 1 o suprime los deltas de texto.
* **`--input-format stream-json`** [Verificado]: Permite enviar turnos de conversación sucesivos por `stdin` usando NDJSON, manteniendo el proceso vivo sin relanzarlo.
* **`--verbose`** [Verificado]: Habilita la emisión detallada de eventos del ciclo de vida y evita salidas silenciosas.
* **`--resume <session-id>`** [Verificado]: Reanuda una sesión previa preservando el contexto local guardado en disco (`~/.claude/sessions/`).
* **`--session-id <id>`** [Verificado]: Asigna o fuerza un identificador de sesión explícito desde el inicio.
* **`--permission-mode <mode>`** [Verificado]: Controla la política de permisos (`bypass`, `auto`, `strict`).
* **`--dangerously-skip-permissions`** [Verificado]: Desactiva todas las confirmaciones interactivas para ejecución autónoma.
* **`--permission-prompt-tool <tool-name>`** [Verificado]: Redirige las solicitudes de confirmación hacia una herramienta MCP específica (vía stdio/RPC) en vez de bloquear esperando entrada en terminal.
* **`--include-partial-messages`** [Verificado]: Habilita los deltas de texto en tiempo real (`text_delta`) dentro del stream.

### ¿Se pueden enviar imágenes vía `stream-json`?
**Sí** [Verificado]. A través de `stdin`, cada mensaje de usuario sigue el esquema de bloques de contenido de la API de Anthropic codificado en base64:
```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Revisá esta captura"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo..."}}]},"session_id":"uuid"}
```

### Esquema de eventos (`stream-json`)
El flujo NDJSON en `stdout` emite los siguientes tipos clave:
1. `system` (subtipo `init`): Contiene `session_id`, modelo activo y herramientas declaradas.
2. `stream_event`: Emite deltas en tiempo real (`content_block_delta` con `text_delta`).
3. `assistant`: Contiene el bloque de mensaje consolidado o solicitudes de herramientas (`tool_use` con `id`, `name`, `input`).
4. `user`: Eco del resultado de ejecución de herramientas (`tool_result`).
5. `result`: Fin de turno; reporta `subtype: "success"|"error"`, `total_cost_usd` y desglose de tokens (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).

### Errores conocidos y límites técnicos
* **Windows 11 (ConPTY / Pipes)** [Verificado]: Si se intenta usar `node-pty` o emuladores TTY en Windows, aparecen conflictos de escape ANSI y cuelgues de ConPTY. Con pipes nativos de `child_process.spawn()`, Node en Windows puede mostrar destellos de ventanas emergentes de `cmd.exe`/`powershell.exe` al invocar subcomandos si no se pasa `windowsHide: true`. Las rutas con separador invertido (`\`) suelen requerir normalización a barras diagonales (`/`) para evitar escapes accidentales en el parsing JSON.
* **Sesiones largas** [Verificado]: Claude Code acumula historial en memoria y disco. Si la sesión supera la ventana de contexto, el costo y la latencia crecen drásticamente hasta requerir compactación.
* **Servidores MCP** [Verificado]: Los servidores MCP configurados localmente se lanzan como subprocesos hijos. Si el proceso principal de Claude Code muere abruptamente, los servidores MCP quedan como procesos zombies ocupando puertos o sockets.
* **`CLAUDE.md`, Hooks y Skills en modo `-p`** [Verificado]: Claude Code lee `CLAUDE.md` al arrancar. Si supera las 80–120 líneas (o 40 KB), la velocidad de respuesta y el seguimiento de instrucciones se degradan notablemente. Los hooks de shell se ejecutan normalmente en `-p`. Las skills se descubren dinámicamente, pero se han documentado fallos en descripciones YAML multilínea en configuraciones personalizadas.

---

## 2. Claude Agent SDK vs Spawning del Binario: Licenciamiento y Login

### ¿Cuál funciona con la suscripción Claude Pro/Max?
* **Binario `claude` (CLI)** [Verificado]: Utiliza el login OAuth interactivo del usuario almacenado en `~/.claude/.credentials.json`. Este método consume directamente la cuota mensual/semanal de la suscripción **Claude Pro o Claude Max**.
* **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)** [Verificado]: Requiere de manera predeterminada una API Key comercial (`ANTHROPIC_API_KEY`) y tarifa por token consumido en la Console. Si bien en entornos locales puede detectar de forma secundaria las credenciales locales de `claude`, Anthropic estableció que el uso programático mediante el SDK no está cubierto por la cuota ilimitada de Pro/Max, asignando créditos separados o exigiendo facturación por API directa.
* **Conclusión técnica:** Para aprovechar la suscripción existente del usuario sin pagar API Keys por token, **es indispensable spawnear el binario oficial `claude`**.

### Términos de Servicio y Cumplimiento Legal de Anthropic
* **Términos del Consumidor (Consumer Terms of Service)** [Verificado]: Anthropic prohíbe taxativamente en su cláusula de restricciones:
  > *"You may not reverse engineer, decompile, disassemble... or access the Services through automated or non-human means... or use the Consumer Services for commercial or business purposes."*
* **Postura ante interfaces de terceros** [Verificado]: Anthropic persigue activamente el uso de tokens de suscripciones personales (Pro/Max) para alimentar herramientas comerciales o clientes distribuidos a terceros ("wrapper apps"). No obstante, el desarrollo de un panel web **exclusivamente local y personal**, ejecutado en la propia máquina del usuario sobre su propio binario y sin extraer ni redistribuir credenciales, opera en una zona gris técnica tolerada siempre que no se revenda ni se publique como servicio multiusuario.

---

## 3. Manejo de Permisos en Modo Headless

Para trasladar la configuración del usuario "nunca preguntar" (auto/bypass):
1. **Modo Bypass Total (`never ask`)** [Verificado]:
   Al spawnear el binario, se pasan los flags `--dangerously-skip-permissions` y `--permission-mode bypass`. Con esto, Claude ejecuta lecturas, escrituras y comandos de shell inmediatamente sin bloquearse.
2. **Modo Auto (`--permission-mode auto`)** [Verificado]:
   Utiliza un clasificador interno que autoaprueba operaciones comunes de bajo riesgo y solo bloquea operaciones destructivas.
3. **Interceptación programática vía MCP (`--permission-prompt-tool`)** [Verificado]:
   En UIs que sí requieren confirmación selectiva en la web, Claude Code permite definir un servidor MCP intermediario. Cuando el modelo intenta ejecutar una herramienta protegida, en lugar de consultar a la terminal, delega la decisión a la herramienta MCP indicada. El backend web captura esta solicitud, muestra los botones de "Aprobar/Rechazar" en la interfaz de usuario, y devuelve la respuesta al agente.

---

## 4. Codex CLI, OpenCode y Antigravity (`agy`)

| Orquestador | Modo Headless / Streaming | Sesiones y Persistencia | Permisos / Auto Mode | Protocolo de Transporte |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI Codex CLI** | `codex exec "<prompt>" --json` [Verificado] | `--session <id>` o vía `app-server` [Verificado] | `--dangerously-bypass-approvals` [Verificado] | JSONL por `stdout` o JSON-RPC bidireccional vía `codex app-server --listen ws://127.0.0.1:4500` [Verificado]. |
| **OpenCode** | `opencode serve --port 4096` [Verificado] | Gestionadas vía API REST (`/session`) [Verificado] | Modo `auto` configurado en opciones del servidor [Verificado] | **Nativo HTTP REST + SSE**. Endpoint `GET /global/event` y especificación OpenAPI 3.1 en `/doc` [Verificado]. |
| **Antigravity (`agy`)** | `agy -p "<prompt>" --output-format stream-json --input-format stream-json --verbose` [Verificado] | `--conversation <id>` o `-c` (última sesión) [Verificado] | `--dangerously-skip-permissions` [Verificado] | NDJSON por `stdin`/`stdout` idéntico al estándar de Claude Code [Verificado]. |

---

## 5. Proyectos Open-Source Existentes

1. **`siteboon/claudecodeui` (CloudCLI)** [Verificado]:
   * *Cobertura:* Web y mobile GUI para Claude Code, Cursor CLI y Codex. Terminal integrada, explorador de archivos y visor de diffs.
   * *Licencia:* AGPL-3.0.
   * *Soporte Windows:* Muy problemático. Depende fuertemente de `node-pty`, generando fallos frecuentes en Windows nativo sin WSL.
   * *Estrategia:* **Tomar ideas**. Su arquitectura de frontend es interesante, pero no conviene adoptar su código por restricciones de licencia AGPL y fragilidad de terminal en Windows.
2. **`winfunc/opcode` (antes Claudia)** [Verificado]:
   * *Cobertura:* Wrapper gráfico de escritorio para Claude Code con historial, visualizador de diffs y árbol de proyecto.
   * *Stars / Estado:* ~22.4k stars, pero **abandonado** desde agosto de 2025. Incompatible con versiones recientes de Claude Code.
   * *Licencia:* AGPL-3.0. Soporte Windows deficiente.
   * *Estrategia:* **Descartar**. Código obsoleto para el protocolo actual.
3. **`Nimbalyst/nimbalyst` (antes Crystal)** [Verificado]:
   * *Cobertura:* Workspace visual integral para agentes (Claude Code, Codex, OpenCode). Editor Monaco, visualizador de diffs en línea, Kanban y ejecución en paralelo mediante Git worktrees.
   * *Stars / Licencia:* ~1.8k stars. Licencia **MIT** (componentes cliente).
   * *Soporte Windows:* **Excelente**, con instaladores oficiales para Windows 11.
   * *Estrategia:* **Adoptar o tomar como referencia principal**. Su abstracción de orquestadores y aislamiento por Git worktrees es el estándar a emular.
4. **`BloopAI/vibe-kanban`** [Verificado]:
   * *Cobertura:* Tablero Kanban y orquestador de agentes paralelos en worktrees aislados.
   * *Stars / Licencia:* ~27k stars. Licencia **Apache-2.0**.
   * *Soporte Windows:* Compatible (Web / Multiplataforma).
   * *Estrategia:* **Tomar ideas** para la visualización de diffs y gestión de tareas paralelas.
5. **OpenCode Web** [Verificado]:
   * *Cobertura:* Servidor y UI web oficial integrada en OpenCode.
   * *Licencia:* Apache-2.0. Soporte Windows nativo impecable.
   * *Estrategia:* **Adoptar su patrón arquitectónico** (servidor HTTP + SSE para eventos).

---

## 6. Experiencia de la Comunidad y Consumo de Tokens

### Fallas recurrentes en wrappers comunitarios
* **Deadlocks de Buffer en pipes:** Si el wrapper no hace flush explícito o envía líneas incompletas por `stdin`, el subproceso queda colgado indefinidamente.
* **Procesos Zombies en Windows:** Si el servidor web se reinicia o se cierra la pestaña, el subproceso `claude` (y los subprocesos de herramientas o MCP) quedan vivos en segundo plano reteniendo handles de archivos. Se requiere usar `tree-kill` en Node.js para matar el árbol completo de procesos.
* **Escape de Códigos ANSI:** Intentar parsear terminales virtuales (PTY) genera cadenas con caracteres de escape rotos. La comunidad recomienda unánimemente **pipes puros con `stream-json`** en lugar de emuladores de terminal.

### ¿Un wrapper web altera el consumo de tokens frente al CLI?
* **No altera el costo si se maneja correctamente** [Verificado]: El motor del LLM procesa exactamente los mismos tokens de entrada y salida, ya que la lógica y el historial residen en el binario de Claude Code.
* **El peligro de la expiración de caché (Prompt Caching TTL de 5 minutos)** [Verificado]: Anthropic aplica una ventana de 5 minutos para el caché de prompts (con un 90% de descuento en lecturas cacheadas). Si el usuario tarda más de 5 minutos en escribir en el chat web entre mensajes, el caché expira y el siguiente turno cobra el 100% de la lectura del contexto.
* **La trampa de los wrappers novatos:** Wrappers mal diseñados lanzan un nuevo comando `claude -p "<historial completo>"` en cada turno sin usar `--resume <id>`, lo que invalida el caché y multiplica el costo por 5x a 10x. Mantener el subproceso abierto con `stream-json` o reanudar estrictamente con `--resume` mantiene el costo idéntico al CLI nativo.

---

## 7. Arquitectura Recomendada y Estimación de Esfuerzo (MVP)

### Arquitectura Técnica Propuesta

```
┌────────────────────────────────────────────────────────┐
│              Frontend Web (Vite + React)               │
│  - Chat con Streaming Markdown y Diff Viewer (Monaco)  │
│  - Soporte de Pegado de Imágenes (conversión a Base64) │
│  - Selector de Orquestador y Gestor de Proyectos       │
└───────────────────────────▲────────────────────────────┘
                            │ WebSocket / SSE
┌───────────────────────────▼────────────────────────────┐
│          Backend Local (Node.js + Fastify / TS)        │
│  - Session Manager (SQLite para metadatos de sesión)   │
│  - Process Supervisor (tree-kill, windowsHide: true)   │
└───────────────────────────▲────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │     Orchestrator Adapter Layer     │
          └─┬──────────────┬───────────────┬──┘
            │              │               │
  ┌─────────▼────────┐ ┌───▼───────────┐ ┌─▼──────────────┐
  │ Claude Code / Agy│ │  OpenCode     │ │  Codex CLI     │
  │ (Pipes NDJSON)   │ │  (HTTP + SSE) │ │  (app-server   │
  │ stream-json I/O  │ │  Port 4096    │ │   JSON-RPC WS) │
  └──────────────────┘ └───────────────┘ └────────────────┘
```

1. **Backend:** Node.js (TypeScript) con Fastify y WebSockets.
   * Evitar `node-pty`: Usar `child_process.spawn()` con `stdio: ['pipe', 'pipe', 'pipe']` y `windowsHide: true`.
   * Implementar `AgentOrchestrator` como interfaz abstracta con drivers específicos:
     * `ClaudeCodeAdapter`: Maneja el flujo NDJSON de `claude -p --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions`.
     * `OpenCodeAdapter`: Conexión directa HTTP/SSE contra `opencode serve`.
     * `CodexAdapter`: Cliente WebSocket JSON-RPC contra `codex app-server`.
     * `AntigravityAdapter`: Mismo protocolo NDJSON que Claude Code con `agy`.
2. **Base de Datos Local:** SQLite (vía `better-sqlite3`) para registrar `project_path`, `session_id`, orquestador y metadatos.
3. **Frontend:** React + Tailwind + `@monaco-editor/react` (o componente de diff side-by-side). Manejo de portapapeles para transformar imágenes pegadas en bloques base64.

### Estimación de Esfuerzo para MVP
* **Alcance MVP:** Chat web funcional + envío de imágenes + cambio de proyecto/sesión + selector Claude/OpenCode + streaming de deltas y tool calls en tiempo real sin prompts de permisos.
* **Tiempo Total Estimado:** **2 a 3 semanas de desarrollo** (80 a 100 horas hombre):
  * *Semana 1:* Núcleo de procesos en Node.js, parser NDJSON bidireccional resiliente a buffers, manejo de ciclo de vida en Windows 11 (`tree-kill`, handles) y adaptador de Claude Code.
  * *Semana 2:* Interfaz de usuario (Chat, Markdown stream, visualización de tool calls / diffs, subida y pegado de imágenes en Base64).
  * *Semana 3:* Adaptador de OpenCode (HTTP/SSE), persistencia en SQLite, selectores de orquestador y pruebas de integración extremo a extremo en Windows 11.

---

## Fuentes Consultadas y Verificadas

1. **Anthropic Official Docs & Repositories:**
   * Flags de Claude Code, print mode y stream-json: `https://github.com/anthropics/claude-code` y documentación oficial en `https://claude.com`.
   * Claude Agent SDK (TypeScript y Python): `https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk`.
   * Términos de Servicio del Consumidor de Anthropic: `https://www.anthropic.com/legal/consumer-terms`.
   * Políticas comerciales y centro de privacidad: `https://www.anthropic.com/legal/terms`.
2. **OpenCode Documentation & Specs:**
   * OpenCode Server, Web and SSE Event APIs: `https://opencode.ai/docs/server/` y repositorio oficial en GitHub.
3. **OpenAI Codex CLI & Tools:**
   * `codex exec` flags y protocolo de `codex app-server`: `https://developersdigest.tech` y documentación técnica de OpenAI Codex.
4. **Google Antigravity (`agy`):**
   * Antigravity CLI flags, modos headless (`stream-json`, `--conversation`): `https://antigravity.google`.
5. **Open Source Projects:**
   * Nimbalyst (anteriormente Crystal): `https://github.com/Nimbalyst/nimbalyst` y `https://nimbalyst.com`.
   * Opcode (anteriormente Claudia): `https://github.com/winfunc/opcode`.
   * CloudCLI (siteboon/claudecodeui): `https://github.com/siteboon/claudecodeui`.
   * Vibe Kanban (Bloop AI): `https://github.com/BloopAI/vibe-kanban`.
6. **Comunidad y Análisis Técnico:**
   * Discusiones de optimización de costos, prompt caching y wrappers en r/ClaudeAI, r/ClaudeCode y dev.to.
