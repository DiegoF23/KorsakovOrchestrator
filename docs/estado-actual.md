# Estado actual (2026-10-05)

## Antigravity CLI

- `agy` 1.2.17 instalado en `%LOCALAPPDATA%\agy\bin\agy.exe` (en el PATH de usuario). Usa la sesión de la app de escritorio; no hace falta login.
- Permisos: `~/.gemini/antigravity-cli/settings.json` (copia de seguridad en `settings.json.bak-2026-10-05`). Lee el MCP de `~/.gemini/antigravity-cli/mcp_config.json` (Engram, Context7, CodeGraph).
- Modelos exactos para `--model`: `Gemini 3.8 Flash (High|Medium|Low)`, `Gemini 3.1 Pro (High|Low)`, `Claude Sonnet 5.5 (Low|Medium|High)`, `Claude Opus 5.5 (Low|Medium|High)`, `GPT-OSS 120B (Medium)`.

## Monitor (FlotaGrupo `tools/fleet-monitor`)

| Rama | Contenido | Estado |
|---|---|---|
| `feat/fleet-monitor-antigravity` | Adaptador de Antigravity (`1c33b111`), corrección de pasos tapados por la respuesta larga (`300b97fb`) | 94 tests OK; sin integrar a `main` |
| `bench/bench-deepseek` | Ocultar terminadas (`5f0b1779`), 5 minutos por defecto y botón para mostrarlas (`d635ed62`) | 105 tests OK; sin integrar |
| `bench/bench-gemini` | Versión perdedora de la prueba (sin commit) | Descartable |

- Monitor de prueba: `127.0.0.1:4201`, corre el código de `bench-deepseek` con la configuración `FlotaGrupo-worktrees/monitor-antigravity/.oc-logs/demo/fleet-monitor.config.json`. Tu monitor de siempre (`:4200`) sigue con el código de `main`.
- Las tareas en segundo plano de una sesión de Claude Desktop se cortan a las 2 horas: los monitores levantados así se apagan solos.

## Scripts (copias en `scripts/`)

| Script | Para qué |
|---|---|
| `agy-run.ps1` | Lanza un turno de `agy`, guarda la actividad en NDJSON, mantiene `status-<pista>.json` (latido cada 30 s), detecta el `SUCCESS` vacío y puede guardar el informe |
| `oc-run.ps1` | Lo mismo para OpenCode, conectado al servidor `:4096` para que el monitor vea la sesión |
| `opencode-quota.mjs` | Cuota de OpenCode Go (hook automático) |
| `statusline-usage.mjs` | Cuota de Claude en la terminal |

## Configuración tocada

- `~/.claude/CLAUDE.md`: secciones "Model routing for delegated agents" y "Claude quota on the fleet monitor".
- `~/.claude/settings.json`: `statusLine` y un hook `UserPromptSubmit` asíncrono para la cuota de OpenCode.
- `~/.claude/quota/`: archivos de cuota que lee el monitor.
