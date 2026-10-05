I have the brief. It's read-only research. Let me gather evidence from primary sources.
Core legal text captured. Now permissions, streaming input format, and SDK docs.
Now Codex, OpenCode, and Antigravity CLIs.
Now the open-source landscape and community experience.
Final evidence round: Windows bugs, permission-prompt MCP tool, and wrapper-specific token effects.
# UI web para manejar Claude Code (y otros CLIs) — Informe de investigación

**Método:** fuentes abiertas y leídas una por una. Cada afirmación va marcada **[V]** (verificada en fuente primaria) o **[U]** (no verificada o secundaria). Fecha: 2026-10-05. Moneda de estrellas/actividad: la vista al momento de consultar.

## 1. Claude Code headless

**Flags** [V: cli-reference + headless]:

- `-p/--print` (no interactivo; lee stdin), `--input-format text|stream-json`, `--output-format text|json|stream-json` (NDJSON), `--include-partial-messages` (deltas), `--verbose`, `--replay-user-messages` (reenvía el mensaje de stdin como ack; exige stream-json en ambos lados).
- Sesiones: `--session-id <uuid válido>`, `--resume <id|nombre|ruta .jsonl>`, `--continue`, `--fork-session`.
- Permisos: `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions` (alias `manual`), `--dangerously-skip-permissions` (= bypassPermissions), `--permission-prompt-tool <mcp_tool>`, `--permission-prompts none` (v2.1.259+), `--allowedTools/--disallowedTools`.
- Otros: `--max-turns` (con stream-json un mensaje enviado mientras trabaja queda encolado y corre como turno propio desde v2.1.205), `--include-hook-events`, `--forward-subagent-text`, `--mcp-config`, `--agents`, `--bare`.

**Esquema** [V: headless]: NDJSON con eventos `system` (el primero es `subtype:"init"`: `session_id`, tools, `mcp_servers`, model, `permissionMode`, skills; también `api_retry`, `plugin_install`), `assistant`, `user` (tool_result), `stream_event` (deltas), `result` (texto final, costo, usage) y `hook_*`. Mensajes de subagentes llevan `parent_tool_use_id`. La entrada documentada (en el SDK, mismo transporte) es `{"type":"user","message":{"role":"user","content":...},"parent_tool_use_id":null}`. El formato de `--input-format stream-json` del CLI no está documentado oficialmente: issue abierto pidiéndolo (#24594) [V del issue].

**Imágenes:** en streaming input del SDK se aceptan bloques `{"type":"image","source":{"type":"base64","media_type","data"}}` [V: streaming-vs-single-mode]. Para el CLI crudo es probable que funcione con el mismo envelope, pero **no está documentado** [U].

**Límites/bugs conocidos** [V issues oficiales]:

- Colgado indefinido del stream en `-p --stream-json` sin timeout de lectura (#53584; la TUI no se ve afectada).
- Sin TTY: crash `Raw mode is not supported` (Ink) al arrancar con ambos stream-json (#36001).
- Windows: `-p` con salida vacía/exit 0 (#50616, #7263); congelamientos por deadlock stdio de Bun al usar subagentes (#28494; workaround: instalar vía npm/Node); procesos huérfanos que acumulan handles y RAM (#89859).
- `stream-json` duplicaba usage entre bloques del mismo mensaje (#6805): no confiar a ciegas en el costo del stream.
- Modo `-p` sin `--bare` carga hooks y MCP del proyecto **sin diálogo de confianza**; skills y CLAUDE.md cargan salvo `--bare`; skills invocables con `/skill` sí funcionan, comandos de terminal no; stdin tope 10 MB; `--mcp-config` espera servidores hasta `MCP_TIMEOUT` (30 s); trabajos en background se cortan ~5 s después del result; espera de drenado de salida hasta 30 s.

## 2. SDK vs binario + legalidad

El Agent SDK "corre el binario de Claude Code" [V: overview]. Texto oficial [V: legal-and-compliance]: OAuth "is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications"; developers "should use API key authentication... Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users". Y la frase clave: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code".

**Lectura:** una UI personal, local, de un solo dueño, que spawnea el binario sin modificarlo y deja que el usuario se loguee con el CLI oficial encaja en el texto permitido; ofrecerla hosteada a terceros intermediando cuentas, no. El overview del SDK lo refuerza ("no permite ofrecer claude.ai login... incluyendo agentes construidos con el Agent SDK") [V]. Hay un pedido de aclaración para `child_process.spawn` desde backend local propio sin respuesta (#56250) [V]. **Recomendación:** subprocess del CLI crudo para suscripción; SDK para API key. Licencias: binario y SDK TS propietarios; wrapper Python MIT [U: research secundario].

## 3. Permisos

- Bypass: `--dangerously-skip-permissions` / `bypassPermissions`; aun así no auto-aprueba reglas `ask`, `AskUserQuestion`, MCP `requiresUserInteraction`, `rm` de rutas críticas, ni ciertas lecturas fuera del workdir [V: permission-modes].
- Aprobación en UI: `canUseTool` (SDK) o `--permission-prompt-tool` (CLI, MCP). El contrato del MCP no está documentado (#24595) [V issue]; ingeniería inversa: input `{tool_name,input,tool_use_id}`, respuesta `{"behavior":"allow","updatedInput":{},"updatedPermissions":[],"interrupt":false}` o deny [U: guías secundarias]. Bug conocido: escrituras a `.claude/**` se bloquean igual tras allow (#54189) [V].
- "Nunca preguntar" se puede llevar con `permissions.defaultMode` + override `--permission-mode` por sesión; la UI debería ofrecer bypass como default y el prompt MCP como opción.

## 4. Otros CLIs

- **Codex** [V: app-server docs]: `codex exec --json` emite NDJSON y `codex exec --json resume --last` reanuda. Para bidireccional: `codex app-server` JSON-RPC 2.0 sobre stdio (default), ws (experimental/no soportado) o unix socket: `initialize`→`initialized`, `thread/start|resume|fork`, `turn/start`, notificaciones `item/*` (`agentMessage/delta`, tools), aprobaciones como requests del server y `thread/tokenUsage/updated`. Es el backend más listo para una UI.
- **OpenCode** [V: docs server]: `opencode serve` levanta HTTP headless con OpenAPI 3.1 en `/doc`; SSE en `/event` (primero `server.connected`) y `/global/event`, con heartbeats. El TUI es cliente de ese server. No verifiqué un comando `opencode web` [U].
- **Antigravity `agy`** [V: headless docs]: `-p`, `--output-format text|json|stream-json`, `--input-format stream-json` (obliga output stream-json; prompts solo por stdin), eventos `init`, `step_update` (`text_delta`, `tool_info`, usage por paso) y `result`; `--conversation <id>`, `-c`, `--dangerously-skip-permissions`, `--print-timeout 5m`. **En stream-json input solo acepta bloques `text`: no hay imágenes por stdin** [V]. Bugs históricos de stdout vacío sin TTY en Windows (#76), aparentemente corregidos desde 1.1.8 [U].

## 5. Proyectos open source existentes

| Proyecto | Cobertura | Actividad | Licencia | Windows |
|---|---|---|---|---|
| CloudCLI (siteboon/claudecodeui) | Web+móvil, Claude/Codex/Cursor/Gemini, sesiones, shell, git, MCP | ~13.5k★, activo (v1.37 jul-2026) | AGPL-3.0-or-later | Sí (web + app companion) |
| opcode (ex-Claudia) | Desktop Tauri, agentes custom, usage, checkpoints | ~22.4k★, sin commits desde oct-2025 [U] | AGPL-3.0 | "coming soon" |
| Nimbalyst (ex-Crystal) | Desktop, kanban, worktrees, editores, iOS | ~1.4k★, activo | MIT | Sí |
| vibe-kanban (ex-Bloop) | Board web local, worktrees, 10+ agentes | ~27.6k★, comunidad desde abr-2026 | Apache-2.0 | Sí |
| opencode | Server oficial + clientes | activo | MIT | Sí |

CloudCLI es el más cercano al objetivo, pero **AGPL**: si lo modificás y lo servís por red, debés publicar tu código. Para algo propio, conviene **tomar ideas** (discovery de sesiones en `~/.claude/projects`, WS/SSE, híbrido pty/SDK) y no forkear. Su issue #300 muestra el patrón CLI-subprocess para suscripción y las dudas vigentes de tokens. A Codex/OpenCode conviene **integrarlos** por sus protocolos oficiales, no reimplementarlos.

## 6. Experiencia comunitaria y costos

Se rompe: colgados de stream (#53584), `-p` mudo en Windows (#50616), freeze Bun en subagentes (#28494), crash sin TTY (#36001), procesos huérfanos (#89859), usage duplicado (#6805); en UIs: "Processing" trabado (#483) y tokens desincronizados (#396) — CloudCLI terminó **eliminando el cálculo visual de tokens** (PR #636). En Reddit el tema dominante es el costo: cache reads ~99% del consumo (#24147), bugs de caché (#16856 y hilos de abr-2026) y `--resume` que invalida caché completa [U]. Sobre si la UI gasta más: no hay impuesto fijo medido; un blog midió 33% más en una semana de VS Code, pero lo atribuye al comportamiento, no a la interfaz [V blog]. **Inferencia [U]:** un solo proceso vivo por sesión (stream-json bidireccional) evita cache-miss de resume por mensaje y puede gastar igual o menos que la terminal; no existe benchmark controlado público.

## 7. Arquitectura y estimación MVP

Servidor local Node/TS + front React; un proceso hijo por sesión: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode <modo>`; primera vez `--session-id <uuid>`, luego `--resume`. Parsear NDJSON a eventos y renderizar texto/tool cards/diffs/result; imágenes como bloques base64 del envelope SDK; agrupar por proyecto escaneando `~/.claude/projects`; transporte browser WebSocket/SSE. Selector de orquestador con adapters: Codex app-server (JSON-RPC), OpenCode serve (SSE), agy (stream-json, sin imágenes). Nunca tocar OAuth: el usuario se loguea con el CLI oficial. Permitir bypass y ofrecer opcionalmente el MCP de permisos.

**Esfuerzo estimado (no verificado), un dev full-time:** 2-4 semanas MVP Claude (chat + imágenes + sesiones por proyecto + streaming + bypass); +1-2 semanas por adapter adicional (Codex el más fácil por protocolo y tokens; agy el más limitado). Riesgos: ciclo de vida de procesos en Windows (colgados/huérfanos) y fidelidad de tokens.

## Fuentes abiertas

1. https://code.claude.com/docs/en/cli-reference
2. https://code.claude.com/docs/en/headless
3. https://code.claude.com/docs/en/legal-and-compliance
4. https://code.claude.com/docs/en/permission-modes
5. https://code.claude.com/docs/en/agent-sdk/overview
6. https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
7. https://code.claude.com/docs/en/agent-sdk/user-input
8. https://code.claude.com/docs/en/agent-sdk/permissions
9. https://antigravity.google/docs/cli/headless/
10. https://developers.openai.com/codex/app-server.md
11. https://developers.openai.com/codex/cli/slash-commands.md
12. https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
13. https://opencode.ai/docs/server/
14. https://github.com/siteboon/claudecodeui
15. https://github.com/siteboon/claudecodeui/issues/300
16. https://github.com/siteboon/claudecodeui/issues/396
17. https://github.com/siteboon/claudecodeui/issues/483
18. https://github.com/siteboon/claudecodeui/pull/636
19. https://github.com/winfunc/opcode
20. https://opcode.sh/
21. https://github.com/nimbalyst/nimbalyst
22. https://github.com/stravu/crystal
23. https://github.com/BloopAI/vibe-kanban
24. https://github.com/anthropics/claude-code/issues/24594
25. https://github.com/anthropics/claude-code/issues/24595
26. https://github.com/anthropics/claude-code/issues/56250
27. https://github.com/anthropics/claude-code/issues/6805
28. https://github.com/anthropics/claude-code/issues/53584
29. https://github.com/anthropics/claude-code/issues/36001
30. https://github.com/anthropics/claude-code/issues/54297
31. https://github.com/anthropics/claude-code/issues/89859
32. https://github.com/anthropics/claude-code/issues/28494
33. https://github.com/anthropics/claude-code/issues/50616
34. https://github.com/anthropics/claude-code/issues/54189
35. https://github.com/anthropics/claude-code/issues/3187
36. https://github.com/anthropics/claude-code/issues/24147
37. https://github.com/anthropics/claude-code/issues/16856
38. https://github.com/google-antigravity/antigravity-cli/issues/76
39. https://github.com/google-antigravity/antigravity-cli/issues/7
40. https://pendnt.dev/guides/permission-prompt-tool
41. https://github.com/UnknownJoe796/claude-code-mcp-permission
42. https://www.reddit.com/r/ClaudeCode/comments/1tts29l/
43. https://www.reddit.com/r/ClaudeCode/comments/1sj10ou/
44. https://docs.bswen.com/blog/2026-04-23-claude-code-extension-token-usage/
45. https://crystl.dev/compare/claude-code-guis/
46. https://news.ycombinator.com/item?id=47352564
47. https://zylos.ai/zh/research/2026-07-13-subscription-auth-boundaries-official-cli-agent-automation/
48. https://archive.ph/G51jH
