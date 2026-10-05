Voy a investigar el brief. Empiezo con búsquedas amplias sobre las tres áreas (monitor multi-proyecto, init de proyecto, y tracking de quota sin requests).
Ahora busco información sobre OpenCode quota tracking y herramientas de init de proyecto para estructura de desarrollo con AI.
Ahora busco más detalles sobre la base de datos local de OpenCode y herramientas adicionales de monitoreo multi-proyecto.
Busco más detalles sobre herramientas de monitoreo multi-proveedor y verifico algunos datos específicos.
Tengo suficiente información. Ahora completo el reporte final.

---

# Reporte de Investigación: Herramientas para orquestar agentes de codificación con IA

## 1. Tabla de proyectos/herramientas

| Nombre | URL | Qué hace | Última actividad | Stars | Licencia | Cubre | Veredicto |
|--------|-----|----------|-------------------|-------|----------|-------|-----------|
| **agentglass** | github.com/SirAllap/agentglass | Cockpit local para todos los agentes de la máquina: Claude Code, Codex, Antigravity vía hooks/OTLP. Incluye diff viewer, terminal PTY, chat, git panel. | 2026 | — | — | A, C | **Adoptar** — el más completo: multi-proveedor, multi-proyecto, con quota y actividad en vivo. |
| **agentpulse** | github.com/jstuart0/agentpulse | Dashboard web local para sesiones Claude Code + Codex. Hooks automáticos, supervisor local, relay remoto. | 2026-09 | — | — | A | **Adoptar** — simple, zero-config, cubre el caso de uso principal (multi-sesión, multi-proyecto). |
| **AgentPulse** | github.com/cdlliuy/AgentPulse | Dashboard web local para Claude Code y GitHub Copilot. Monitoreo en vivo, editor CLAUDE.md, memoria. | 2026-04 | — | — | A | **Prestar ideas** — buen modelo de auto-descubrimiento sin config. |
| **agent-cockpit** | github.com/agent-cockpit/agent-cockpit | Cockpit local-first con mapa pixel-art, approvals unificados, timeline, diffs, memoria. Claude + Codex. | 2026 | — | — | A | **Prestar ideas** — excelente UX de approvals y timeline. |
| **claude-orchestrator** | github.com/phahadek/claude-orchestrator | Dashboard web para sesiones Claude Code paralelas. Worktrees, PR review automático, task boards. | 2026 | — | — | A | **Prestar ideas** — buen modelo de worktree isolation y PR lifecycle. |
| **AgentMonitor** | github.com/Ericonaldo/AgentMonitor | Dashboard web para agentes Claude Code y Codex. Streaming, pipelines, worktree isolation, relay remoto. | 2026 | — | — | A | **Prestar ideas** — buen modelo de task pipelines y meta-agent. |
| **agent-orchestrator** | github.com/Kaairofelipe/agent-orchestrator | Spawn de agentes paralelos con worktrees, branches, PRs. Dashboard + CLI. | 2026-02 | — | — | A | **Skip** — menos maduro que las alternativas. |
| **code-orchestrator** | github.com/antonioromano/code-orchestrator | Dashboard web para múltiples sesiones de agentes (Claude, Gemini, Codex) vía PTY. | 2026-03 | — | — | A | **Skip** — solo terminal streaming, sin quota ni lifecycle. |
| **claude-code-orchestrator** | github.com/trillion-labs/claude-code-orchestrator | Dashboard web para sesiones Claude Code en local y remoto vía SSH. | 2026 | — | — | A | **Skip** — solo Claude Code, sin quota. |
| **agent-pulse** | github.com/Dipen-Dedania/agent-pulse | App Electron cross-platform con bubbles flotantes para estado de agentes. Claude, Cursor, Codex, Kiro, Antigravity. | 2026-04 | — | — | A, C | **Prestar ideas** — buen modelo de status bridge unificado y quota pollers. |
| **agentinit** | github.com/agentinit/agentinit | CLI universal para configs de agentes IA. Un solo source of truth (`agents.md`), genera archivos para cada agente. | 2026 | — | — | B | **Adoptar** — exactamente lo que se necesita para B: un comando init portable. |
| **agent-app** | github.com/chcardoz/agent-app | Scaffolder `create-*` para proyectos con agentes. `AGENTS.md` canónico, `.mcp.json`, skills compartidas. | 2026 | — | — | B | **Adoptar** — simple, cubre Claude/OpenCode/Codex/Cursor/Gemini. |
| **aicode-toolkit** | github.com/agiflow/aicode-toolkit | Toolkit con scaffolding, design patterns, review rules vía MCP. | 2025-10 | — | — | B | **Prestar ideas** — buen modelo de templates + MCP servers. |
| **enterprise-superpowers** | github.com/idiaz01/enterprise-superpowers | CLI que genera plugins Claude Code con skills, agents, commands, hooks, MCPs. | 2026-03 | — | — | B | **Skip** — muy específico para plugins Claude Code enterprise. |
| **scaffolding** | github.com/komluk/scaffolding | Plugin Claude Code con 13 agents, 36 skills, 19 commands, 15 hooks. Markdown puro. | 2026 | — | — | B | **Prestar ideas** — buen modelo de estructura de agents/skills/hooks. |
| **ai-agent-project-template** | github.com/rumotion/ai-agent-project-template | Template con AGENTS.md, Memory Bank, workflows, skills, MCP config. 9 adaptadores. | 2026 | — | — | B | **Prestar ideas** — buen modelo de Memory Bank y FAST_INIT. |
| **ccusage** | github.com/wakamex/ccusage | Monitor de uso Claude Code. Lee archivos locales + API OAuth. Statusline, daemon, JSON. | 2026 | — | — | C | **Adoptar** — estándar de facto para quota Claude Code. |
| **quota-guard** | github.com/pareshrnayak/quota-guard | CLI que bloquea prompts antes de hitting rate limits. Lee rate_limits del statusline. | 2026 | — | — | C | **Prestar ideas** — buen modelo de captura vía statusline. |
| **codex-limit** | github.com/kajiwara321/codex-limit | CLI lightweight para quota Codex. Usa `codex app-server` JSON-RPC. | 2026 | — | — | C | **Adoptar** — simple, zero CPU, JSON-RPC puro. |
| **agy-cli-usage** | github.com/abruption/agy-cli-usage | Monitor headless para quota Antigravity. API directa + PTY fallback. JSON output. | 2026-06 | — | — | C | **Adoptar** — el único que cubre Antigravity headless. |
| **agy-usage** | pypi.org/project/agy-usage/ | CLI Python para quota Antigravity. Lee token OAuth, llama API Cloud Code. | 2026-06 | — | — | C | **Adoptar** — alternativa Python, con daemon y statusline. |
| **openusage** | github.com/janekbaraniewski/openusage | Dashboard terminal local para 36 providers. Quota, spend, rate limits. | 2026-08 | — | — | C | **Adoptar** — el más completo para multi-proveedor. |
| **opencode-quota** | github.com/slkiser/opencode-quota | Plugin OpenCode para quota y tokens. Lee opencode.db + provider APIs. | 2026-01 | — | — | C | **Adoptar** — específico para OpenCode. |

## 2. Sección C: Quota sin requests de modelo

### Claude Code
**Verificado.** Desde v2.1.80, Claude Code expone `rate_limits` (five_hour/seven_day `used_percentage` + `resets_at`) en el JSON que envía al stdin del comando `statusline`. Esto se puede capturar sin ningún request de modelo:

- **ccusage** (wakamex/ccusage): Lee `~/.claude/.credentials.json` (OAuth token) y llama `GET https://api.anthropic.com/api/oauth/usage`. No es un model request. También lee `~/.claude/stats-cache.json` y `~/.claude/projects/**/*.jsonl` para tokens locales. **Verificado** en README y PyPI.
- **quota-guard** (pareshrnayak/quota-guard): Registra un comando `statusLine` que lee `rate_limits.five_hour` y `rate_limits.seven_day` del stdin JSON y los escribe a `~/.claude/quota-guard/history.jsonl`. Cero requests de red. **Verificado** en README.
- **claude-code-usage-guard** (eltonylfgi-blip/claude-code-usage-guard): Shim de statusline que snapshotea `rate_limits` a `~/.claude/.usage-guard-limits.json`. Sin red. **Verificado** en README.
- **budmon** (weilhalt/budmon): Intercepta headers `anthropic-ratelimit-unified-*` de cada respuesta API y los escribe a `~/.claude/usage-limits.json`. Sin requests adicionales. **Verificado** en README.

### Codex CLI
**Verificado.** El CLI expone `codex app-server` con JSON-RPC. El método `account/rateLimits/read` devuelve quota sin ser un model request:

- **codex-limit** (kajiwara321/codex-limit): Lanza `codex app-server`, envía `initialize` + `account/rateLimits/read` vía JSON-RPC, parsea y sale. **Verificado** en README.
- **codex-usage-tracker** (CasperKristiansson/codex-usage-tracker): Lee `~/.codex/sessions/**/rollout-*.jsonl` para tokens. Para quota, usa el mismo endpoint. **Verificado** en README.
- **openusage** (janekbaraniewski/openusage): Lee `~/.codex/auth.json` y opcionalmente llama la API de ChatGPT. **Verificado** en docs.

### OpenCode
**Verificado.** OpenCode almacena todo en `~/.local/share/opencode/opencode.db` (SQLite, modo WAL). Se puede leer directamente sin requests:

- **opencode-quota** (slkiser/opencode-quota): Lee `opencode.db` (solo lectura) para tokens por sesión. Para quota de proveedores, llama APIs de providers. **Verificado** en README y npm.
- **opencode-quota-tracker** (tongsh6/opencode-token-tracker): Lee `opencode.db` y `~/.config/opencode/logs/token-tracker/tokens.jsonl`. **Verificado** en README.
- **opencode-usage-plugin** (npm): Lee tokens de OpenCode y auth plugins. **Verificado** en npm.

### Antigravity CLI
**Verificado.** Se puede leer quota sin model requests vía dos caminos:

- **agy-cli-usage** (abruption/agy-cli-usage): Lee el token OAuth de `~/.gemini/antigravity-cli/antigravity-oauth-token` y llama `POST /v1internal:loadCodeAssist` + `POST /v1internal:retrieveUserQuotaSummary`. No es un model request. Fallback: PTY con `@xterm/headless`. **Verificado** en README.
- **agy-usage** (pypi): Similar. Lee token, llama API Cloud Code. También puede usar RPC local `GetUserStatus`. **Verificado** en PyPI.
- **antigravity-cli-check-usage-plugin** (tanaikech): Usa el endpoint RPC local `/exa.language_server_pb.LanguageServerService/GetUserStatus` en `127.0.0.1`. **Verificado** en README.

## 3. Recomendación

### A. Multi-project local monitor
**Adoptar agentglass** como base. Es el único que cubre Claude Code, Codex Y Antigravity con un modelo de datos unificado (hooks + OTLP). Incluye project picker, transcript scanner, diff viewer, terminal PTY, y chat. Para un caso de uso más simple, **agentpulse** es alternativa zero-config.

### B. Project init command
**Adoptar agentinit** como base. Un solo `agents.md` como source of truth, genera archivos para cada agente (Claude, Codex, OpenCode, Cursor, Gemini, etc.), gestiona skills y MCPs. Complementar con **agent-app** para scaffolding inicial.

### C. Quota tracking
**Adoptar openusage** como dashboard unificado. Cubre los 4 CLIs + 32 providers más. Para uso individual, usar **ccusage** (Claude), **codex-limit** (Codex), **opencode-quota** (OpenCode), **agy-cli-usage** (Antigravity).

### Top 5 ideas para copiar
1. **Statusline capture pattern** (quota-guard): Un comando statusline que lee `rate_limits` del stdin JSON y lo escribe a un archivo local. Simple, zero-cost, zero-network.
2. **Transcript scanner** (agentglass): Leer `~/.claude/projects/**/*.jsonl` directamente para historial completo sin hooks.
3. **Provider adapters normalizados** (agent-cockpit): Un schema de eventos unificado que normaliza hooks de diferentes proveedores.
4. **Worktree isolation** (claude-orchestrator): Cada agente trabaja en su own worktree bajo `.claude/worktrees/`.
5. **opencode.db read-only** (opencode-quota): Abrir la DB SQLite en modo WAL read-only para no bloquear al proceso owner.

## 4. Fuentes abiertas

1. github.com/SirAllap/agentglass (README)
2. github.com/jstuart0/agentpulse (README)
3. github.com/cdlliuy/AgentPulse (README)
4. github.com/agent-cockpit/agent-cockpit (README)
5. github.com/phahadek/claude-orchestrator (README)
6. github.com/Ericonaldo/AgentMonitor (README)
7. github.com/Kaairofelipe/agent-orchestrator (README)
8. github.com/antonioromano/code-orchestrator (README)
9. github.com/trillion-labs/claude-code-orchestrator (README)
10. github.com/Dipen-Dedania/agent-pulse (README)
11. github.com/agentinit/agentinit (README)
12. github.com/chcardoz/agent-app (README)
13. github.com/agiflow/aicode-toolkit (README)
14. github.com/idiaz01/enterprise-superpowers (README)
15. github.com/komluk/scaffolding (README)
16. github.com/rumotion/ai-agent-project-template (README)
17. github.com/wakamex/ccusage (README + PyPI)
18. github.com/pareshrnayak/quota-guard (README)
19. github.com/eltonylfgi-blip/claude-code-usage-guard (README)
20. github.com/weilhalt/budmon (README)
21. github.com/kajiwara321/codex-limit (README)
22. github.com/CasperKristiansson/codex-usage-tracker (README)
23. github.com/janekbaraniewski/openusage (README + docs)
24. github.com/slkiser/opencode-quota (README + npm)
25. github.com/tongsh6/opencode-token-tracker (README)
26. github.com/abruption/agy-cli-usage (README)
27. pypi.org/project/agy-usage/ (PyPI)
28. github.com/tanaikech/antigravity-cli-check-usage-plugin (README)
29. github.com/anthropics/claude-code/issues/91279 (GitHub issue)
30. github.com/anthropics/claude-code/issues/13585 (GitHub issue)
31. github.com/anthropics/claude-code/issues/39874 (GitHub issue)
32. antigravity.google/docs/cli/commands/usage/ (docs)
33. antigravity.google/docs/cli/credits/ (docs)
34. opencode.ai/docs/cli/ (docs)
35. opencode.ai/docs/config/ (docs)
