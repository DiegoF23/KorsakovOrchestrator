# Harnesses de agentes 2026 vs. nuestro flujo

Leyenda: **(v)** = dato verificado abriendo la fuente; **(s/v)** = sin verificar (snippet, metadata de API o comportamiento no probado). Stars/push consultados a la API de GitHub el 2026-10-05.

## 1. Panorama de harnesses

| Herramienta | Stars / último push | Licencia | Windows | CLIs | Orquestador | Auth | Worktree | Cuota |
|---|---|---|---|---|---|---|---|---|
| **claude-squad** (github.com/smtg-ai/claude-squad) | 8,6k / ago-2026 (v) | AGPL-3.0 (v) | No nativo: requiere tmux + gh y script bash (v) | `claude` por defecto; codex, gemini, aider, cualquier comando (v) | Humano, TUI (v) | Lanza los CLIs oficiales con el login del usuario (v) | Sí, git worktrees (v) | No (v) |
| **Conductor** (conductor.build) | Propietario, activo (v) | Propietaria, gratis hoy (v) | No: solo Mac (v) | Claude Code, Codex, Cursor, OpenCode; trae binarios propios de CC/Codex (v) | Humano, app Mac (v) | Reusa los tokens locales (Pro/Max o API key); modo API key opcional (v) | Sí, workspace por rama (v) | No (v) |
| **Vibe Kanban** (github.com/BloopAI/vibe-kanban) | 28,3k / sep-2026 (v) | Apache-2.0 (v) | Sí, binario local (s/v) | 10+: Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen (v) | Humano (web UI); existe plugin externo Claude `/orchestrate` vía MCP (s/v) | CLIs autenticados por el usuario (v) | Sí (v) | No (v). **En cierre**: bloop cerró el 2026-04-10; el OSS sigue comunitario y los servicios remotos se eliminan (v) |
| **Crystal → Nimbalyst** (stravu/crystal → nimbalyst/nimbalyst) | 3,1k (feb-2026, deprecado) → 1,8k (oct-2026) (v) | MIT (v) | Nimbalyst: Win/mac/Linux + móvil (s/v); Crystal: Mac (s/v) | Claude Code, Codex, OpenCode (v) | Humano, Electron (v) | Lanza los CLIs; login propio (v) | Sí (v) | No (s/v) |
| **ccmanager** (github.com/kbwo/ccmanager) | 1,3k / sep-2026 (v) | MIT (v) | Sí: sin tmux; estado en `%APPDATA%` (v) | claude, gemini, codex, cursor-agent, copilot, cline, opencode, kimi, mcode (v) | Humano, TUI (v) | Lanza los CLIs oficiales (v) | Sí (v) | No (v) |
| **amux** (github.com/mixpeek/amux) | 514 / oct-2026 (v) | MIT según README; API dice "Other" (v) | No: macOS/Linux + tmux (v) | Claude Code, Codex, Gemini CLI (v) | Humano (dashboard) **+ agentes entre sí**: tablero kanban, REST/MCP, mensajería (v) | Lanza CLIs en tmux (v) | Parcial: detecta conflictos, aislamiento manual (v) | Tokens/costo por sesión; watchdog de rate-limits (v) |
| **cmux** (github.com/manaflow-ai/cmux) | 27,6k / oct-2026 (v) | GPL según la web; GitHub "Other" (v) | No: macOS (v) | Cualquier agente de terminal (Claude Code, Codex, OpenCode, Gemini…) (v) | Humano (terminal GUI + socket API) (v) | CLIs con login propio (v) | No nativo; worktrees vía plugins (s/v) | No (s/v) |
| **agentglass** (github.com/SirAllap/agentglass) | 330 / oct-2026 (v) | MIT (v) | Build Windows aún no verificado en hardware real; CI verde (v) | Observa Claude Code/Codex/Gemini CLI/OpenCode; chat contra `claude`, `codex` y `agy` (v) | Humano; es capa de visibilidad, "no un harness" (v) | Hooks + scanner de transcripts; no proxyea ni guarda credenciales (v) | Sí: tarea/issue → worktree (v) | Costo/tokens/tool calls; no cuota % (v) |
| **Claude-Code-Agent-Monitor** (github.com/hoangsonww/Claude-Code-Agent-Monitor) | 1,0k / oct-2026 (v) | MIT (v) | Sí: web + apps Win/mac (v) | Claude Code; Codex beta, vía hooks (v) | Humano (dashboard + MCP de consulta) (v) | Hooks nativos; no toca credenciales (v) | No (v) | Tokens/costo con tabla de precios (v) |

**Antigravity `agy`**: solo agentglass lo nombra explícitamente (chat) (v). claude-squad y ccmanager pueden lanzar comandos arbitrarios, así que `agy` entraría si es una TUI común (s/v); cmux acepta cualquier binario de terminal (v); el resto no lo soporta.

**Dato transversal**: todos los "session managers" son interfaces para humanos. Ninguno orquesta con IA propia; a lo sumo exponen API/MCP (amux, Vibe Kanban, Claude-Code-Agent-Monitor, roadmap MCP de agentglass). Ninguno muestra la cuota real de Pro/Max (ventana 5h/semanal): muestran tokens/costo estimados desde hooks/transcripts (agentglass, CCAM) o manejan el rate-limit cuando aparece (amux) (v). Anthropic solo exporta costo/tokens por OpenTelemetry, no cuota restante (v).

## 2. Logins de suscripción Claude: ¿es legal?

Fuentes normativas (v, leídas completas):

- **code.claude.com/docs/en/legal-and-compliance**: OAuth "is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans" y está diseñado para "ordinary use of Claude Code". Textual: *"Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens"*. Y el permiso explícito: *"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code"*; el binario no puede modificarse ni restringirse su método de login, y está prohibido revender/intermediar el consumo.
- **Consumer ToS §3.7** (vigente 2025-10-08): no acceder a los Servicios por medios automatizados/no humanos *"except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it"*.

Hechos de enforcement (v, prensa e issues abiertos): en ene-2026 Anthropic implementó bloqueos técnicos contra harnesses que suplantaban al cliente oficial, con baneos colaterales luego revertidos (VentureBeat); en feb-2026 aclaró que nada cambiaba para Agent SDK/Max (The New Stack); el **19-mar-2026 OpenCode eliminó su OAuth de Claude por pedido legal** (PR #18186; issues #6930 y #18329; el README de jcubic/opencode-claude-plan documenta §3.7 y el retiro).

**Conclusión práctica**: el patrón permitido es lanzar el **binario oficial sin modificar** y que cada usuario complete su propio login; eso es exactamente lo que hacen claude-squad, ccmanager y Conductor (reusar tokens locales). Lo prohibido es que la app tercerice el login de Claude.ai o intermedie tokens Free/Pro/Max. Manejar la TUI por script queda en zona gris frente a §3.7, y los límites de Pro/Max asumen "ordinary, individual usage" (v). No es asesoría legal.

## 3. Encaje con nuestro flujo

Nuestro orquestador es IA (Claude Desktop) y lanza CLIs headless. Ningún session manager puede ser conducido por esa IA: son UIs humanas. Solo tienen superficie programática:

- **Sin cambiar el flujo (solo observabilidad)**: **agentglass** es la única que ya cuelga de sesiones tmux/transcripts, corre como app de escritorio, no proxyea credenciales y hasta chatea con `agy` (v); su build Windows está sin verificar (v). **CCAM** aporta app Windows y MCP de consulta, pero sus hooks se instalan globales en `~/.claude/settings.json`, así que también capturaría al orquestador (v). Ninguna reemplaza nuestros medidores de cuota.
- **Cambiando el flujo**: **amux** sería el control-plane más cercano (REST/MCP, tablero, agentes que se delegan trabajo), pero es macOS/Linux, sin `agy` ni OpenCode, y su aislamiento es parcial (v) — perderíamos Windows y nuestro monitor. **Vibe Kanban** vía MCP podría orquestarse desde Claude, pero está en sunsetting: adoptarlo como base es riesgo innecesario (v). **claude-squad / Conductor / cmux / ccmanager / Nimbalyst** exigen un humano en la UI; adoptarlos implicaría invertir nuestro flujo (la IA pasaría a ser el worker, no el orquestador).

**Recomendación técnica**: mantener el flujo actual; si querés más visibilidad, evaluar agentglass (Windows sin verificar) o CCAM como capa adicional, aceptando que ninguna cubre cuota real ni `agy` de punta a punta. No migrar la orquestación a un harness humano, y no adoptar un producto en cierre.

## Fuentes abiertas

- `brief.md` (local).
- API GitHub: repos `smtg-ai/claude-squad`, `BloopAI/vibe-kanban`, `kbwo/ccmanager`, `stravu/crystal`, `nimbalyst/nimbalyst`, `mixpeek/amux`, `SirAllap/agentglass`, `hoangsonww/Claude-Code-Agent-Monitor`, `manaflow-ai/cmux`.
- READMEs: claude-squad, ccmanager, agentglass.
- code.claude.com/docs/en/legal-and-compliance; code.claude.com/docs/en/agent-teams; code.claude.com/docs/en/monitoring-usage.
- anthropic.com/legal/consumer-terms (v2025-10-08).
- conductor.build/docs, /docs/faq, /docs/concepts/parallel-agents.
- vibekanban.com/blog/shutdown; PR #3388.
- github.com/anomalyco/opencode issues #6930 y #18329; README de jcubic/opencode-claude-plan.
- VentureBeat (2026-01-09), The New Stack (2026-02-18), AI News Silo (2026-03-26).
- nimbalyst.com/crystal; GitHub manaflow-ai/cmux (README vía búsqueda).

Nota interna: Engram no me dejó guardar el resumen (varias sesiones activas ambiguas); el reporte completo queda en este mensaje.
