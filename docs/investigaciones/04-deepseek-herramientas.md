Now let me verify the remaining candidate repos efficiently via the GitHub API (lighter than full pages) — these give stars, license and last-push dates.
# Investigación: herramientas para orquestar agentes de IA (A/B/C)

Convención: **[V]** = leído en la fuente citada; **[NV]** = no verificado o no hallado. Estrellas y última actividad (pushed_at) vía API de GitHub, consultada el 2026-10-05.

## 1. Tabla de proyectos

| Proyecto | URL | Qué hace | Últ. act. | ★ | Lic. | A/B/C | Veredicto |
|---|---|---|---|---|---|---|---|
| ctop | github.com/aakashadesara/ctop | TUI tipo htop: sesiones Claude Code/Codex/OpenCode/Devin, tokens, contexto, costo, ramas, compactación y rate-limit; CLI para agentes. Windows vía PowerShell (CWD limitado) [V] | 2026-09-26 | 93 | MIT | A+C | Adoptar ya como monitor vivo |
| CloudCLI (claudecodeui) | github.com/siteboon/claudecodeui | Web UI multi-proyecto para Claude/Cursor CLI/Codex/OpenCode: descubre sesiones, chat, shell, explorador de archivos, git (stage/commit/branch), MCP, móvil [V] | 2026-10-05 | 13.9k | AGPL-3.0 | A | Mejor base web; AGPL a evaluar |
| agent-dashboard | github.com/bjornjee/agent-dashboard | Orquestador tmux+PWA: estados blocked/waiting/running/review/PR/merged, subagentes, diffs, barras de rate-limit, PRs [V] | 2026-07-12 | 24 | MIT | A | Copiar ideas; Windows no soportado [V] |
| plum-code-webui | github.com/zwaetschge/plum-code-webui | Web UI self-hosted (Docker) para Codex/OpenCode/Claude: sesiones, streaming, git, analítica y barra de límites de Codex si hay OAuth [V] | 2026-10-03 | 27 | MIT | A+C | Probar en Docker Windows |
| opencode-observability | github.com/abekdwight/opencode-observability | Monitor/viewer local-first de OpenCode (y Claude/Codex), server 127.0.0.1:3737, plugin zero-setup y hooks que abren el monitor antes del modelo (0 tokens) [V] | 2026-09-19 | 0 | MIT | A | Copiar patrón hooks+SSE |
| Claude-Code-Usage-Monitor | github.com/Maciek-roboblog/Claude-Code-Usage-Monitor | Monitor de terminal del uso/burn-rate de Claude desde JSONL, con predicciones y alertas [V] | 2026-07-05 | 8.7k | MIT | A+C | Adoptar para cuota Claude |
| agent-lens | github.com/naimjeem/agent-lens | Dashboard local de uso/tokens/costos de 8 agentes (Claude, Codex, Gemini, OpenCode, Kimi, Cursor, Antigravity —solo metadatos protobuf—, Copilot), rutas por SO [V] | 2026-05-13 | 21 | sin licencia | A+C | Copiar adaptadores (ojo: sin licencia) |
| agentglass | github.com/SirAllap/agentglass | Cockpit web/desktop multi-proyecto: hooks de Claude + OTLP GenAI, costos, sesiones, git, terminal PTY, selector de proyecto [V] | 2026-10-05 | 330 | MIT | A | El más cercano al objetivo A |
| Extensión VS Code | github.com/janzofx/vscode-extension-opencode-claude-code-monitor | Dashboard read-only Claude/OpenCode/Codex con delegaciones, timeline de archivos y poda de su estado propio a 7 días (auto-limpieza) [V] | 2026-04-06 | 1 | MIT | A | Copiar auto-limpieza; poco mantenido |
| gentle-ai | github.com/Gentleman-Programming/gentle-ai | Configurador de ecosistema: Engram, SDD, skills, MCP, persona y permisos por agente; `--scope workspace`, `/sdd-init` y skill-registry por proyecto [V] | 2026-10-05 | 7.5k | MIT | B | Adoptar (ya está en uso) |
| agentinit | github.com/agentinit/agentinit | CLI universal: `agents.md` fuente única que sincroniza CLAUDE.md/.cursorrules/Codex/OpenCode/etc., detecta stack e instala skills/MCP con lockfile [V] | 2026-05-24 | 4 | Apache-2.0 | B | Copiar modelo sync/lockfile |
| claude-init | github.com/horiastanxd/claude-init | Un comando escanea el repo y genera 13 archivos de contexto por herramienta, 100% local, CLI+MCP [V] | 2026-06-21 | 1 | MIT | B | Copiar generador de contexto |
| klaussy-agents | github.com/steph-dove/klaussy-agents | Scaffolder multi-agente (10 entornos, incl. Antigravity y OpenCode) que compila un CLAUDE.md canónico a rules/skills/hooks/permisos nativos [V] | 2026-09-27 | 16 | MIT | B | Copiar mapa de rutas por agente |
| claude-code-templates | github.com/davila7/claude-code-templates | CLI + catálogo: 400+ agentes, 225+ comandos, MCPs, hooks, settings, skills y workflows [V] | 2026-10-05 | 32.4k | MIT | B | Adoptar como catálogo |
| spec-kit | github.com/github/spec-kit | Toolkit SDD de GitHub: `specify init` + skills constitution→specify→clarify→plan→checklist→tasks→analyze→implement→converge [V] | 2026-10-05 | 140k | MIT | B | Adoptar para specs formales |
| OpenSpec | github.com/Fission-AI/OpenSpec | SDD para asistentes con artefactos versionados; backend SDD que gentle-ai soporta [V] | 2026-10-05 | 71k | MIT | B | Adoptar si se versionan specs |
| BMAD-METHOD | github.com/bmad-code-org/BMAD-METHOD | `npx bmad-method install`: 8 agentes por fase (analyst/PM/architect/dev/qa/SM/…), artefactos en `_bmad-output`; soporta Claude Code, Codex y Antigravity [V] | 2026-10-05 | 53.8k | Other | B | Copiar agentes por fase (pesado) |
| ccusage | github.com/ccusage/ccusage | CLI multi-agente desde archivos locales (Claude, Codex, OpenCode, Antigravity, etc.): daily/weekly/session, `blocks` (ventanas 5 h de Claude) y statusline [V] | 2026-10-05 | 18.9k | Other | C | Adoptar |
| antigravity-usage | github.com/skainguyen1412/antigravity-usage | Cuota de Antigravity vía language server local del IDE (lo que ve el IDE) o fallback a Google Cloud Code API con OAuth; salida JSON [V] | 2026-02-24 | 394 | MIT | C | Adoptar/copiar |
| aistat | github.com/drogers0/aistat | Cuota de Claude y Codex desde endpoints de rate-limit (no modelo), con JSON y `reset_after_seconds` [V] | 2026-09-18 | 14 | MIT | C | Copiar endpoint Codex |
| codex-ratelimit | github.com/xiangz19/codex-ratelimit | Parsea `~/.codex/sessions/**/*.jsonl` (`token_count` con `rate_limits` 5 h/7 d) y muestra TUI en vivo; offline [V] | 2025-11-20 | 8 | sin licencia | C | Copiar modo offline |
| openusage | github.com/robinebers/openusage | App macOS de suscripciones (Claude, Codex, OpenCode Go/Zen, Cursor…): Go desde `/zen/go/v1/usage` y gasto local desde SQLite [V] | 2026-10-04 | 4.3k | MIT | C | Copiar lógica de proveedores |

## 2. Sección C — Cuota sin gastar tokens

**Claude Code**
- Statusline (documentado): Claude Code ejecuta el script localmente y **no consume tokens de API**; le pasa por stdin `rate_limits.five_hour.used_percentage` / `.resets_at` y `rate_limits.seven_day.*` (solo Pro/Max, tras la primera respuesta de la sesión; puede faltar cada ventana). Se re-ejecuta al llegar cada `resets_at` y con `refreshInterval` [V]. Es la cuota exacta, cero tokens, pero pasiva y atada a una sesión viva.
- Histórico offline: `~/.claude/projects/**/*.jsonl` (o `~/.config/claude/projects/`); ccusage `blocks` reconstruye ventanas de 5 h y Claude-Code-Usage-Monitor calcula burn-rate [V]. Es estimación de consumo, no "restante" oficial.
- `/usage` del TUI muestra las ventanas; es interactivo y no programable por agentes [V parcial: docs de costs/statusline lo referencian].
- Endpoint OAuth `api.anthropic.com/api/oauth/usage` (fallback que usan aistat y ClaudeCodeStatusLine): **[NV]** — no está en docs oficiales.

**Codex**
- `codex app-server` (local, JSON-RPC por stdio): métodos `account/rateLimits/read` ("fetch ChatGPT rate limits"), `account/usage/read` y notificación `account/rateLimits/updated`; no invoca al modelo, autentica con tu OAuth [V, docs OpenAI]. Está marcado experimental [V]. Herramientas que ya lo hacen: `codex-limit` (npm), `codex-status-mcp`, `codex-cli-usage`, `aistat` [V].
- Offline: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`, eventos `token_count` con `rate_limits.primary/secondary.used_percent` y resets (codex-ratelimit) [V]. Puede quedar viejo (refleja la última sesión).
- `/status` y `/statusline` (tokens `five-hour-limit`, `weekly-limit`) en el TUI [V].

**OpenCode**
- Suscripción Go: `GET https://opencode.ai/zen/go/v1/usage` con `Authorization: Bearer <opencode-go key>` devuelve `{usage:{rolling,weekly,monthly}}` con `percent` y `resetsAt` — contabilidad oficial, cero tokens de modelo. La key vive en `~/.local/share/opencode/auth.json` (OpenCode 1) o en las DB locales (OpenCode 2) [V, docs de openusage + PR #1097 + issue cc-switch #6433]. No está en los docs oficiales de OpenCode **[NV oficial]**; la doc oficial sí define los límites: 5 h = 20 %, semana = 50 %, mes = 100 % del tope mensual por modelo [V].
- Uso local: SQLite `~/.local/share/opencode/opencode*.db` (Windows: `%LOCALAPPDATA%\opencode` o `%APPDATA%\opencode` si existen), tablas `message`/`session_message` con tokens y `cost` [V]. El plugin `opencode-quota-tracker` agrega `/quota` y declara que "no envía un prompt ni llama a un modelo" [V vía índice de búsqueda; la página npm me devolvió 403].
- Para proveedores no-Go (Anthropic/OpenAI por API key) no hay "cuota restante": solo gasto local.

**Antigravity**
- CLI: `/usage` (alias `/quota`) refresca config y cuota "en disco y desde el backend" y abre un panel TUI [V, docs oficiales]. No es automatizable; los docs no aclaran su costo en cuota **[NV]**.
- RPC local cero-modelo: el proceso `agy` expone un server HTTPS gRPC/Connect en `127.0.0.1`; `POST /exa.language_server_pb.LanguageServerService/GetUserStatus` devuelve `remainingFraction` (5 h) y `resetTime` ISO. Hay que probar los puertos del proceso [V, artículo de tanaike 2026-08-12]. **El límite semanal NO se expone por ese RPC → no encontrado.** Antigravity-usage usa lo mismo en modo local y, como fallback, la Google Cloud Code API con OAuth [V].
- `~/.gemini/antigravity` (protobuf): ccusage/agent-lens solo leen metadatos de sesión, no cuota [V].
- Semanal sin modelo: **no encontrado** ningún archivo/endpoint documentado; el foro oficial muestra que ni el IDE lo expone bien.

**Transversal:** "cero tokens" no significa "cero red": los endpoints consultan contabilidad del proveedor sin generar inferencia.

## 3. Recomendación

**A — Construir (fino), no adoptar tal cual.** Ningún proyecto combina selector multi-proyecto + orquestador/workers en vivo + ramas + cuotas + auto-limpieza + Windows. Sugerencia: corto plazo usar ctop (npm/Windows) y activar statusline de Claude + `account/rateLimits/read` de Codex; medio plazo construir una app local chica (web local o Tauri) leyendo los mismos almacenes locales, sin red.
Top 5 ideas para copiar:
1. Descubrimiento por almacenes locales con adaptadores por SO: procesos (`ps`/PowerShell) + JSONL/SQLite (ctop, agent-lens).
2. Máquina de estados de sesión y agrupación (blocked/waiting/running/review/PR/merged), subagentes y planes (agent-dashboard).
3. Ciclo de vida con auto-limpieza: poda a 7 días del estado propio (extensión VS Code) + detección de sesiones "ghost" y kill masivo (ctop).
4. Cuotas pasivas sin modelo: statusline Claude (evento al `resets_at`), Codex `account/rateLimits/read`, OpenCode `/zen/go/v1/usage`, Antigravity `GetUserStatus` (solo 5 h).
5. UI multi-proyecto: un select de proyecto que escopa sesiones/git/cuotas, con SSE/WebSocket y git integrado (CloudCLI/agentglass/plum).

**B — Adoptar la base y envolverla.** gentle-ai ya cubre memoria, MCP, skills y persona, con `--scope workspace` + `/sdd-init` + skill-registry por proyecto: es lo más cercano al "init" pedido y ya está instalado. Sumar como referencias: agentinit (fuente única + lockfile), claude-init (generación de contexto por stack), klaussy (rutas/permisos por agente incl. Antigravity), claude-code-templates (catálogo) y spec-kit/OpenSpec (specs). Recomendación concreta: un comando `project-init` que orqueste detección de stack → `gentle-ai install --scope workspace` + `sdd-init` → AGENTS.md/CLAUDE.md sincronizados (modelo agentinit) → MCP/connectors (Engram/Context7) → docs/data → commit inicial. Reutilizar, no reinventar.

**C — Veredicto de viabilidad:** Claude Code sí (statusline exacto sin tokens, pasivo; ccusage para histórico). Codex sí (app-server local y/o JSONL). OpenCode sí para Go (`/zen/go/v1/usage`); no-Go solo gasto local. Antigravity parcial: 5 h por RPC local; **semanal no encontrado**.

## 4. Fuentes abiertas

Docs oficiales: code.claude.com/docs/en/statusline · developers.openai.com/codex/app-server · help.openai.com/articles/11369540 · antigravity.google/docs/cli/commands/usage/ · antigravity.google/docs/plans/ · opencode.ai/docs/go/ · opencode.ai/v2/docs/console/usage/.
Artículos/análisis: tanaikech.github.io (plugin de hooks de cuota Antigravity, 2026-08-12) · shipyard.build/blog/claude-code-track-usage · ghendigital.com (BMAD vs SDD).
Repos y páginas de contenido (abiertas vía fetch o búsqueda web con contenido): ctop, siteboon/claudecodeui, bjornjee/agent-dashboard, zwaetschge/plum-code-webui, abekdwight/opencode-observability, Maciek-roboblog/Claude-Code-Usage-Monitor, naimjeem/agent-lens, SirAllap/agentglass, janzofx/vscode-extension-opencode-claude-code-monitor, Gentleman-Programming/gentle-ai (+ docs intended-usage, usage, agents, skill-registry, components), agentinit/agentinit, horiastanxd/claude-init, KwokJay/cc-agent-harness, steph-dove/klaussy-agents, davila7/claude-code-templates (+ docs.aitmpl.com), github/spec-kit (quickstart, core), Fission-AI/OpenSpec, bmad-code-org/BMAD-METHOD (PR #1501), ccusage/ccusage, skainguyen1412/antigravity-usage, drogers0/aistat, xiangz19/codex-ratelimit, robinebers/openusage (+ docs/providers/opencode.md, PR #1097), farion1231/cc-switch issue #6433, openai/codex issues #20310/#15281/#24080, npm codex-limit, DrSmile444/codex-status-mcp, simonesiega/codex-limits, npm opencode-quota-tracker, Zendevve/Antigravity-Usage, OmerFarukOruc/antigravity-dashboard.
Metadatos (estrellas/fecha/licencia): `api.github.com/repos/<owner>/<repo>` para cada proyecto de la tabla.
