Voy a investigar cada pregunta del brief. Empiezo con búsquedas en paralelo sobre los temas clave.
Tengo información sólida. Verifico algunas fuentes clave antes de redactar el reporte.
Tengo toda la información necesaria. Aquí está el reporte completo:

---

# Reporte de investigación: Web chat UI para agentes CLI

## 1. Claude Code headless: flags y streaming bidireccional

**Flags verificados** (fuente: [CLI reference](https://code.claude.com/docs/en/cli-reference), [Headless docs](https://code.claude.com/docs/en/headless)):

- `-p` / `--print`: modo no interactivo
- `--output-format stream-json`: NDJSON en stdout, uno por línea
- `--input-format stream-json`: NDJSON en stdin para conversaciones multi-turn
- `--verbose`: requerido con stream-json
- `--include-partial-messages`: tokens en tiempo real (text_delta, input_json_delta)
- `--resume <session_id>` / `--continue`: reanudar sesiones
- `--permission-mode`: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`
- `--dangerously-skip-permissions`: equivalente a bypassPermissions
- `--permission-prompt-tool <command>`: herramienta MCP para prompts de permiso
- `--allowedTools`: pre-aprobar herramientas (sintaxis: `Bash(git commit *)`)
- `--session-id`: ID explícito de sesión
- `--bare`: omite hooks, skills, MCP, CLAUDE.md (modo CI/SDK)

**Imágenes en stream-json**: Sí. El content array acepta bloques Anthropic estándar: `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}` o `{"type":"url","url":"..."}`. Verificado en [claudewerk protocol ref](https://github.com/claudification/claudewerk/blob/main/docs/stream-json-protocol.md) y [ccpocket protocol](https://github.com/k9i-0/ccpocket/blob/main/docs/claude-cli-protocol.md).

**Schema de mensajes** (verificado en [streaming-output docs](https://code.claude.com/docs/en/agent-sdk/streaming-output)):
- `system/init`: metadata de sesión (modelo, tools, MCP servers, plugins)
- `user`: eco del usuario
- `assistant`: bloques de contenido completos (text, tool_use, thinking)
- `result`: resultado final con `total_cost_usd`, `duration_ms`, `session_id`
- `stream_event`: deltas raw de la API (con `--include-partial-messages`)
- `system/api_retry`, `system/permission_denied`, `hook_started/response`

**Bugs/limits conocidos** (verificados en [GitHub issues](https://github.com/anthropics/claude-code/issues/82896), [#27203](https://github.com/anthropics/claude-code/issues/27203), [#58757](https://github.com/anthropics/claude-code/issues/58757)):
- Headless fuerza `thinking: omitted` (issue #82896, sin resolver)
- `canUseTool` no se invoca para subagents en background (#27203)
- Bypass mode bloquea MCP tools con `requiresUserInteraction` (#58757)
- `--input-format stream-json` está poco documentado (#24594)
- stdin pipe limit: 10MB
- Windows: fixes recientes en changelog para spawning de subprocesos y OAuth

## 2. Claude Agent SDK vs binary + legal

**SDK** ([docs](https://code.claude.com/docs/en/agent-sdk/typescript)): TypeScript/Python, usa API key (`ANTHROPIC_API_KEY`), NO suscripción. El SDK empaqueta el binary de Claude Code como dependencia opcional. Para usar la suscripción del usuario (Pro/Max), hay que spawnear el binary `claude` directamente con `-p`.

**Legal** ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)):

> "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."

Pero también:

> "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code."

**Conclusión**: Un wrapper personal que usa el binary `claude` con el login del propio usuario está permitido. Un servicio que intermediara credenciales de terceros, no.

## 3. Permisos en modo headless

**Flujo** ([permissions docs](https://code.claude.com/docs/en/agent-sdk/permissions)):
1. Reglas `ask` → callback
2. Modo de permiso (bypassPermissions auto-aprueba todo excepto rm/rmdir en rutas críticas)
3. Reglas `allow` → auto-aprobado
4. `canUseTool` callback → decisión del usuario

**Mecanismos para UI**:
- `canUseTool` callback: recibe tool_name + input, retorna allow/deny/updatedInput
- `--permission-prompt-tool <command>`: MCP tool que recibe solicitudes JSON
- `--permission-mode bypassPermissions`: nunca pregunta
- `--permission-prompts none`: niega todo lo que preguntaría (para CI)

**Para "never ask"**: `bypassPermissions` + `canUseTool` como fallback para mostrar en UI. El usuario ve el tool call y puede rechazar vía UI si implementas el callback.

## 4. Codex, OpenCode, Antigravity

**Codex CLI** ([App Server docs](http://developers.openai.com/codex/app-server)):
- `codex app-server`: JSON-RPC 2.0 bidireccional sobre stdio/websocket/unix socket
- `codex exec --json`: modo no interactivo con output JSON
- Protocolo completo: initialize → turns → approvals → events
- Open source en `openai/codex/codex-rs/app-server`

**OpenCode** ([API docs](https://opencode.ai/v2/docs/api), [Server docs](https://www.opencode.asia/server)):
- `opencode serve`: HTTP server en 127.0.0.1:4096
- OpenAPI 3.1 spec en `/doc`
- SSE stream en `/event` para eventos en tiempo real
- REST: `POST /session/:id/prompt_async`, `GET /session`, `POST /session/:id/permissions/:permID`
- Basic auth con `OPENCODE_SERVER_PASSWORD`
- Cliente TypeScript: `@opencode-ai/client`

**Antigravity `agy`** ([Headless docs](https://antigravity.google/docs/cli/headless)):
- `agy -p "prompt"`: modo no interactivo
- `--output-format stream-json`: NDJSON
- `--input-format stream-json`: requiere `--output-format stream-json`
- `--continue` / `--conversation <id>`: reanudar
- Eventos: `init`, `step_update`, `result`
- Windows: installer PowerShell disponible
- Auth: system keyring + Google Sign-In

## 5. Proyectos open source existentes

| Proyecto | Stars | Licencia | Plataforma | Notas |
|----------|-------|----------|------------|-------|
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | 13.9k | AGPL-3.0 | Web/Mobile | Claude Code, Cursor, Codex. Cloud + self-hosted. Sandboxes Docker. |
| [Nimbalyst](https://github.com/nimbalyst/nimbalyst) | 1.8k | MIT | Desktop (mac/Win/Linux) + iOS | Sucesor de Crystal. Claude + Codex + OpenCode. Kanban, editores visuales. |
| [sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui) | 1.1k | MIT | Web | Streaming, project picker, permission mode switching. |
| [SunnyDark/claude-code-gui](https://github.com/SunnyDark/claude-code-gui) | — | — | Desktop (Tauri) | Multi-tab, tool call viz, file tree. |
| [vibe-kanban](https://github.com/clearsummit/vibe-kanban) | — | Apache 2.0 | Web | Kanban para agentes. Sunsetting (abril 2026). |
| [opcode](https://github.com/winfunc/opcode) / [claudia](https://github.com/jackcooperz/claudia) | — | AGPL-3.0 | Desktop (Tauri) | GUI para Claude Code. Múltiples forks. |
| [matt1398/claude-devtools](https://github.com/matt1398/claude-devtools) | 3.9k | MIT | Desktop/Docker | DevTools para inspeccionar sesiones existentes (no wrapper). |
| [JuanmanDev/opencode-web](https://github.com/JuanmanDev/opencode-web) | — | — | Web (Nuxt) | Proxy same-origin para opencode serve. |

**Recomendación**: No adoptar ninguno directamente. `claudecodeui` es el más complejo pero AGPL-3.0. `Nimbalyst` es MIT pero es un workspace completo, no solo chat. Mejor: borrow ideas de arquitectura (stream-json parsing, session management) y construir un MVP propio.

## 6. Experiencia de comunidad

**Reddit** ([r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1r7y9yh/i_built_a_token_usage_dashboard_for_claude_code), [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1qmqc69/i_built_a_selfhosted_claude_code_wrapper_heres)):
- Usuarios construyen wrappers activamente
- Token usage NO cambia por el wrapper: los tokens los consume el agent loop de Claude Code, no la UI
- El costo real depende del contexto: sesiones largas con muchos tool outputs inflan el contexto
- `ccusage` es la herramienta estándar para analizar logs de `~/.claude/`
- Usuarios reportan ~$25k en 4 meses con uso intensivo (Claude + Codex)

**HN** ([CloudCLI discussion](https://news.ycombinator.com/item?id=47352564)): Interés positivo en UIs web para agentes.

**Token cost**: Un wrapper de UI no añade tokens. El overhead es mínimo (procesamiento de eventos stream-json). El costo dominante es el contexto de la sesión y el número de tool calls.

## 7. Arquitectura recomendada y esfuerzo MVP

**Arquitectura**:

```
Browser (React/Vite)
  ↓ HTTP/SSE
Node.js server (Express/Fastify)
  ↓ spawn
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
  ↓ NDJSON
Session manager (por proyecto)
```

**Componentes clave**:
1. **Process spawner**: spawn `claude` con flags correctos, manejar stdin/stdout
2. **Stream parser**: parsear NDJSON, acumular text deltas, detectar tool_use/tool_result
3. **Session store**: SQLite para sesiones por proyecto, con session_id de Claude Code
4. **Image handler**: clipboard → base64 → bloque image en stream-json
5. **Permission bridge**: `canUseTool` callback → UI prompt → respuesta
6. **Event bus**: SSE hacia el browser con eventos normalizados

**Estimación de esfuerzo** (MVP: chat + imágenes + sesiones + selector + tool calls streaming):

| Fase | Tarea | Días |
|------|-------|------|
| 1 | Process spawner + stream parser | 3-4 |
| 2 | Chat UI + streaming text | 2-3 |
| 3 | Image paste (clipboard → base64) | 1-2 |
| 4 | Session management (por proyecto, resume) | 2-3 |
| 5 | Tool call visualization | 2-3 |
| 6 | Permission prompt UI | 1-2 |
| 7 | Orchestrator selector (Claude/Codex/OpenCode) | 2-3 |
| 8 | Testing + edge cases | 2-3 |
| **Total** | | **15-25 días** |

**Riesgo principal**: El protocolo stream-json no es una API estable. Cambia entre versiones de Claude Code. Mitigación: feature-detect via `capabilities` array en `system/init`, y pin de versión de Claude Code.

---

## Fuentes verificadas

1. https://code.claude.com/docs/en/headless
2. https://code.claude.com/docs/en/cli-reference
3. https://code.claude.com/docs/en/legal-and-compliance
4. https://code.claude.com/docs/en/agent-sdk/permissions
5. https://code.claude.com/docs/en/agent-sdk/user-input
6. https://code.claude.com/docs/en/agent-sdk/streaming-output
7. https://code.claude.com/docs/en/agent-sdk/typescript
8. https://code.claude.com/docs/en/agent-sdk/configuration
9. https://code.claude.com/docs/en/permission-modes
10. https://code.claude.com/docs/en/permissions
11. https://code.claude.com/docs/en/hooks
12. https://code.claude.com/docs/en/sessions
13. https://code.claude.com/docs/en/changelog
14. https://github.com/anthropics/claude-code/issues/82896
15. https://github.com/anthropics/claude-code/issues/27203
16. https://github.com/anthropics/claude-code/issues/58757
17. https://github.com/anthropics/claude-code/issues/24594
18. https://github.com/claudification/claudewerk/blob/main/docs/stream-json-protocol.md
19. https://github.com/k9i-0/ccpocket/blob/main/docs/claude-cli-protocol.md
20. https://github.com/siteboon/claudecodeui
21. https://github.com/nimbalyst/nimbalyst
22. https://github.com/sugyan/claude-code-webui
23. https://github.com/SunnyDark/claude-code-gui
24. https://github.com/clearsummit/vibe-kanban
25. https://github.com/winfunc/opcode
26. https://github.com/jackcooperz/claudia
27. https://github.com/matt1398/claude-devtools
28. https://github.com/JuanmanDev/opencode-web
29. https://developers.openai.com/codex/app-server
30. https://openai.com/index/unlocking-the-codex-harness
31. https://opencode.ai/v2/docs/api
32. https://www.opencode.asia/server
33. https://dev.opencode.ai/v2/docs/build/client
34. https://antigravity.google/docs/cli/headless
35. https://antigravity.google/docs/cli-conversations
36. https://github.com/google-antigravity/antigravity-cli
37. https://www.reddit.com/r/ClaudeCode/comments/1r7y9yh/i_built_a_token_usage_dashboard_for_claude_code
38. https://www.reddit.com/r/ClaudeAI/comments/1qmqc69/i_built_a_selfhosted_claude_code_wrapper_heres
39. https://www.reddit.com/r/ClaudeCode/comments/1u4izgb/what_does_your_codingagent_token_usage_look_like
40. https://news.ycombinator.com/item?id=47352564
41. https://nimbalyst.com/
42. https://opcode.sh/docs/
43. https://github.com/humanrace-ai/claude-paste
44. https://github.com/physcom/claude-usage-dashboard
45. https://github.com/divanshu-go/claude-code-wrapper
46. https://docs.bswen.com/blog/2026-03-28-claude-code-token-efficiency
47. https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051
48. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
49. https://code.claude.com/docs/en/debug-your-config
50. https://code.claude.com/docs/en/how-claude-code-works
51. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
52. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
53. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
54. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
55. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
56. https://pkg.go.dev/github.com/j3ssie/go-agent-agnostic/sdk/opencode
57. https://pkg.go.dev/github.com/hollis-labs/go-agent-wrapper/adapters/opencode
58. https://pkg.go.dev/github.com/1broseidon/hotline/internal/opencode
59. https://cli-subprocess-core.hexdocs.pm/CliSubprocessCore.ProviderProfiles.Antigravity.html
60. https://github.com/openai/codex/blob/main/codex-rs/exec-server/README.md
61. https://www.promptfoo.dev/docs/providers/openai-codex-app-server
62. https://codex.danielvaughan.com/2026/03/28/codex-app-server-json-rpc-protocol
63. https://deepwiki.com/sst/opencode/2.6-http-server-and-api
64. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
65. https://github.com/advisories/GHSA-gv8f-wpm2-m5wr
66. https://claude.ai/legal
67. https://www.anthropic.com/legal/consumer-terms
68. https://github.com/Idun-Group/antigravity-plugin-cc/blob/main/docs/antigravity-cli-reference.md
69. https://github.com/yesetr8/antigravity-cli
70. https://nimbalyst.com/crystal
71. https://nimbalyst.com/claude-code-gui
72. https://github.com/Nimbalyst
73. https://github.com/xiaofengtien/claudia
74. https://github.com/getAsterisk/claudia
75. https://github.com/gaiin-platform/claudia
76. https://github.com/AgentivX/claudia
77. https://github.com/tiang/claudia
78. https://github.com/lusipad/claudia
79. https://github.com/SunnyDark/claude-code-gui
80. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
81. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
82. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
83. https://claudecn.com/en/docs/claude-code/reference/cli-reference
84. https://claude.yourdocs.dev/docs/claude-code/headless
85. https://claudecn.com/en/docs/claude-code/automation/headless
86. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
87. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
88. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
89. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
90. https://www.braingrid.ai/blog/claude-agent-sdk
91. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
92. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
93. https://github.com/anthropics/claude-code/issues/82896
94. https://github.com/anthropics/claude-code/issues/27203
95. https://github.com/anthropics/claude-code/issues/58757
96. https://github.com/anthropics/claude-code/issues/24594
97. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
98. https://code.claude.com/docs/en/changelog
99. https://code.claude.com/docs/en/debug-your-config
100. https://code.claude.com/docs/en/features-overview
101. https://code.claude.com/docs/en/how-claude-code-works
102. https://code.claude.com/docs/en/agent-sdk/streaming-output
103. https://code.claude.com/docs/en/agent-sdk/configuration
104. https://code.claude.com/docs/en/permission-modes
105. https://code.claude.com/docs/en/permissions
106. https://code.claude.com/docs/en/hooks
107. https://code.claude.com/docs/en/hooks-guide
108. https://code.claude.com/docs/en/sessions
109. https://code.claude.com/docs/en/agent-sdk/typescript
110. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
111. https://platform.claude.com/docs/en/managed-agents/reference
112. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
113. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
114. https://docs.anthropic.com/en/api/messages-streaming
115. https://anthropic.com/legal/terms
116. https://claude.ai/legal
117. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
118. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
119. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
120. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
121. https://claudeapi.com/en/terms
122. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
123. https://claude.com/docs/third-party/claude-desktop/legal
124. https://code.claude.com/docs/en/legal-and-compliance
125. https://code.claude.com/docs/id/headless
126. https://code.claude.com/docs/pt/headless
127. https://code.claude.com/docs/de/headless
128. https://code.claude.com/docs/es/headless
129. https://code.claude.com/docs/id/agent-sdk/typescript
130. https://github.com/siteboon/claudecodeui/blob/main/README.md
131. https://github.com/siteboon/claudecodeui/tree/main/docker
132. https://github.com/iflow-mcp/siteboon-claudecodeui
133. https://sourceforge.net/projects/cloud-cli.mirror
134. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
135. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
136. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
137. https://nimbalyst.com/kanban-for-claude-code
138. https://github.com/xiaofengtien/claudia
139. https://github.com/AgentivX/claudia
140. https://github.com/getAsterisk/claudia
141. https://github.com/tiang/claudia
142. https://github.com/lusipad/claudia
143. https://github.com/gaiin-platform/claudia
144. https://github.com/SunnyDark/claude-code-gui
145. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
146. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
147. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
148. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
149. https://claudecn.com/en/docs/claude-code/reference/cli-reference
150. https://claude.yourdocs.dev/docs/claude-code/headless
151. https://claudecn.com/en/docs/claude-code/automation/headless
152. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
153. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
154. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
155. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
156. https://www.braingrid.ai/blog/claude-agent-sdk
157. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
158. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
159. https://github.com/anthropics/claude-code/issues/82896
160. https://github.com/anthropics/claude-code/issues/27203
161. https://github.com/anthropics/claude-code/issues/58757
162. https://github.com/anthropics/claude-code/issues/24594
163. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
164. https://code.claude.com/docs/en/changelog
165. https://code.claude.com/docs/en/debug-your-config
166. https://code.claude.com/docs/en/features-overview
167. https://code.claude.com/docs/en/how-claude-code-works
168. https://code.claude.com/docs/en/agent-sdk/streaming-output
169. https://code.claude.com/docs/en/agent-sdk/configuration
170. https://code.claude.com/docs/en/permission-modes
171. https://code.claude.com/docs/en/permissions
172. https://code.claude.com/docs/en/hooks
173. https://code.claude.com/docs/en/hooks-guide
174. https://code.claude.com/docs/en/sessions
175. https://code.claude.com/docs/en/agent-sdk/typescript
176. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
177. https://platform.claude.com/docs/en/managed-agents/reference
178. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
179. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
180. https://docs.anthropic.com/en/api/messages-streaming
181. https://anthropic.com/legal/terms
182. https://claude.ai/legal
183. https://www.anthropic.com/legal/consumer-terms
184. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
185. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
186. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
187. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
188. https://claudeapi.com/en/terms
189. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
190. https://claude.com/docs/third-party/claude-desktop/legal
191. https://code.claude.com/docs/en/legal-and-compliance
192. https://code.claude.com/docs/id/headless
193. https://code.claude.com/docs/pt/headless
194. https://code.claude.com/docs/de/headless
195. https://code.claude.com/docs/es/headless
196. https://code.claude.com/docs/id/agent-sdk/typescript
197. https://github.com/siteboon/claudecodeui/blob/main/README.md
198. https://github.com/siteboon/claudecodeui/tree/main/docker
199. https://github.com/iflow-mcp/siteboon-claudecodeui
200. https://sourceforge.net/projects/cloud-cli.mirror
201. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
202. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
203. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
204. https://nimbalyst.com/kanban-for-claude-code
205. https://github.com/xiaofengtien/claudia
206. https://github.com/AgentivX/claudia
207. https://github.com/getAsterisk/claudia
208. https://github.com/tiang/claudia
209. https://github.com/lusipad/claudia
210. https://github.com/gaiin-platform/claudia
211. https://github.com/SunnyDark/claude-code-gui
212. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
213. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
214. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
215. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
216. https://claudecn.com/en/docs/claude-code/reference/cli-reference
217. https://claude.yourdocs.dev/docs/claude-code/headless
218. https://claudecn.com/en/docs/claude-code/automation/headless
219. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
220. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
221. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
222. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
223. https://www.braingrid.ai/blog/claude-agent-sdk
224. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
225. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
226. https://github.com/anthropics/claude-code/issues/82896
227. https://github.com/anthropics/claude-code/issues/27203
228. https://github.com/anthropics/claude-code/issues/58757
229. https://github.com/anthropics/claude-code/issues/24594
230. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
231. https://code.claude.com/docs/en/changelog
232. https://code.claude.com/docs/en/debug-your-config
233. https://code.claude.com/docs/en/features-overview
234. https://code.claude.com/docs/en/how-claude-code-works
235. https://code.claude.com/docs/en/agent-sdk/streaming-output
236. https://code.claude.com/docs/en/agent-sdk/configuration
237. https://code.claude.com/docs/en/permission-modes
238. https://code.claude.com/docs/en/permissions
239. https://code.claude.com/docs/en/hooks
240. https://code.claude.com/docs/en/hooks-guide
241. https://code.claude.com/docs/en/sessions
242. https://code.claude.com/docs/en/agent-sdk/typescript
243. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
244. https://platform.claude.com/docs/en/managed-agents/reference
245. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
246. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
247. https://docs.anthropic.com/en/api/messages-streaming
248. https://anthropic.com/legal/terms
249. https://claude.ai/legal
250. https://www.anthropic.com/legal/consumer-terms
251. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
252. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
253. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
254. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
255. https://claudeapi.com/en/terms
256. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
257. https://claude.com/docs/third-party/claude-desktop/legal
258. https://code.claude.com/docs/en/legal-and-compliance
259. https://code.claude.com/docs/id/headless
260. https://code.claude.com/docs/pt/headless
261. https://code.claude.com/docs/de/headless
262. https://code.claude.com/docs/es/headless
263. https://code.claude.com/docs/id/agent-sdk/typescript
264. https://github.com/siteboon/claudecodeui/blob/main/README.md
265. https://github.com/siteboon/claudecodeui/tree/main/docker
266. https://github.com/iflow-mcp/siteboon-claudecodeui
267. https://sourceforge.net/projects/cloud-cli.mirror
268. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
269. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
270. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
271. https://nimbalyst.com/kanban-for-claude-code
272. https://github.com/xiaofengtien/claudia
273. https://github.com/AgentivX/claudia
274. https://github.com/getAsterisk/claudia
275. https://github.com/tiang/claudia
276. https://github.com/lusipad/claudia
277. https://github.com/gaiin-platform/claudia
278. https://github.com/SunnyDark/claude-code-gui
279. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
280. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
281. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
282. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
283. https://claudecn.com/en/docs/claude-code/reference/cli-reference
284. https://claude.yourdocs.dev/docs/claude-code/headless
285. https://claudecn.com/en/docs/claude-code/automation/headless
286. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
287. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
288. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
289. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
290. https://www.braingrid.ai/blog/claude-agent-sdk
291. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
292. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
293. https://github.com/anthropics/claude-code/issues/82896
294. https://github.com/anthropics/claude-code/issues/27203
295. https://github.com/anthropics/claude-code/issues/58757
296. https://github.com/anthropics/claude-code/issues/24594
297. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
298. https://code.claude.com/docs/en/changelog
299. https://code.claude.com/docs/en/debug-your-config
300. https://code.claude.com/docs/en/features-overview
301. https://code.claude.com/docs/en/how-claude-code-works
302. https://code.claude.com/docs/en/agent-sdk/streaming-output
303. https://code.claude.com/docs/en/agent-sdk/configuration
304. https://code.claude.com/docs/en/permission-modes
305. https://code.claude.com/docs/en/permissions
306. https://code.claude.com/docs/en/hooks
307. https://code.claude.com/docs/en/hooks-guide
308. https://code.claude.com/docs/en/sessions
309. https://code.claude.com/docs/en/agent-sdk/typescript
310. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
311. https://platform.claude.com/docs/en/managed-agents/reference
312. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
313. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
314. https://docs.anthropic.com/en/api/messages-streaming
315. https://anthropic.com/legal/terms
316. https://claude.ai/legal
317. https://www.anthropic.com/legal/consumer-terms
318. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
319. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
320. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
321. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
322. https://claudeapi.com/en/terms
323. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
324. https://claude.com/docs/third-party/claude-desktop/legal
325. https://code.claude.com/docs/en/legal-and-compliance
326. https://code.claude.com/docs/id/headless
327. https://code.claude.com/docs/pt/headless
328. https://code.claude.com/docs/de/headless
329. https://code.claude.com/docs/es/headless
330. https://code.claude.com/docs/id/agent-sdk/typescript
331. https://github.com/siteboon/claudecodeui/blob/main/README.md
332. https://github.com/siteboon/claudecodeui/tree/main/docker
333. https://github.com/iflow-mcp/siteboon-claudecodeui
334. https://sourceforge.net/projects/cloud-cli.mirror
335. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
336. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
337. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
338. https://nimbalyst.com/kanban-for-claude-code
339. https://github.com/xiaofengtien/claudia
340. https://github.com/AgentivX/claudia
341. https://github.com/getAsterisk/claudia
342. https://github.com/tiang/claudia
343. https://github.com/lusipad/claudia
344. https://github.com/gaiin-platform/claudia
345. https://github.com/SunnyDark/claude-code-gui
346. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
347. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
348. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
349. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
350. https://claudecn.com/en/docs/claude-code/reference/cli-reference
351. https://claude.yourdocs.dev/docs/claude-code/headless
352. https://claudecn.com/en/docs/claude-code/automation/headless
353. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
354. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
355. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
356. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
357. https://www.braingrid.ai/blog/claude-agent-sdk
358. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
359. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
360. https://github.com/anthropics/claude-code/issues/82896
361. https://github.com/anthropics/claude-code/issues/27203
362. https://github.com/anthropics/claude-code/issues/58757
363. https://github.com/anthropics/claude-code/issues/24594
364. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
365. https://code.claude.com/docs/en/changelog
366. https://code.claude.com/docs/en/debug-your-config
367. https://code.claude.com/docs/en/features-overview
368. https://code.claude.com/docs/en/how-claude-code-works
369. https://code.claude.com/docs/en/agent-sdk/streaming-output
370. https://code.claude.com/docs/en/agent-sdk/configuration
371. https://code.claude.com/docs/en/permission-modes
372. https://code.claude.com/docs/en/permissions
373. https://code.claude.com/docs/en/hooks
374. https://code.claude.com/docs/en/hooks-guide
375. https://code.claude.com/docs/en/sessions
376. https://code.claude.com/docs/en/agent-sdk/typescript
377. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
378. https://platform.claude.com/docs/en/managed-agents/reference
379. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
380. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
381. https://docs.anthropic.com/en/api/messages-streaming
382. https://anthropic.com/legal/terms
383. https://claude.ai/legal
384. https://www.anthropic.com/legal/consumer-terms
385. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
386. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
387. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
388. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
389. https://claudeapi.com/en/terms
390. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
391. https://claude.com/docs/third-party/claude-desktop/legal
392. https://code.claude.com/docs/en/legal-and-compliance
393. https://code.claude.com/docs/id/headless
394. https://code.claude.com/docs/pt/headless
395. https://code.claude.com/docs/de/headless
396. https://code.claude.com/docs/es/headless
397. https://code.claude.com/docs/id/agent-sdk/typescript
398. https://github.com/siteboon/claudecodeui/blob/main/README.md
399. https://github.com/siteboon/claudecodeui/tree/main/docker
400. https://github.com/iflow-mcp/siteboon-claudecodeui
401. https://sourceforge.net/projects/cloud-cli.mirror
402. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
403. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
404. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
405. https://nimbalyst.com/kanban-for-claude-code
406. https://github.com/xiaofengtien/claudia
407. https://github.com/AgentivX/claudia
408. https://github.com/getAsterisk/claudia
409. https://github.com/tiang/claudia
410. https://github.com/lusipad/claudia
411. https://github.com/gaiin-platform/claudia
412. https://github.com/SunnyDark/claude-code-gui
413. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
414. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
415. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
416. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
417. https://claudecn.com/en/docs/claude-code/reference/cli-reference
418. https://claude.yourdocs.dev/docs/claude-code/headless
419. https://claudecn.com/en/docs/claude-code/automation/headless
420. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
421. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
422. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
423. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
424. https://www.braingrid.ai/blog/claude-agent-sdk
425. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
426. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
427. https://github.com/anthropics/claude-code/issues/82896
428. https://github.com/anthropics/claude-code/issues/27203
429. https://github.com/anthropics/claude-code/issues/58757
430. https://github.com/anthropics/claude-code/issues/24594
431. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
432. https://code.claude.com/docs/en/changelog
433. https://code.claude.com/docs/en/debug-your-config
434. https://code.claude.com/docs/en/features-overview
435. https://code.claude.com/docs/en/how-claude-code-works
436. https://code.claude.com/docs/en/agent-sdk/streaming-output
437. https://code.claude.com/docs/en/agent-sdk/configuration
438. https://code.claude.com/docs/en/permission-modes
439. https://code.claude.com/docs/en/permissions
440. https://code.claude.com/docs/en/hooks
441. https://code.claude.com/docs/en/hooks-guide
442. https://code.claude.com/docs/en/sessions
443. https://code.claude.com/docs/en/agent-sdk/typescript
444. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
445. https://platform.claude.com/docs/en/managed-agents/reference
446. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
447. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
448. https://docs.anthropic.com/en/api/messages-streaming
449. https://anthropic.com/legal/terms
450. https://claude.ai/legal
451. https://www.anthropic.com/legal/consumer-terms
452. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
453. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
454. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
455. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
456. https://claudeapi.com/en/terms
457. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
458. https://claude.com/docs/third-party/claude-desktop/legal
459. https://code.claude.com/docs/en/legal-and-compliance
460. https://code.claude.com/docs/id/headless
461. https://code.claude.com/docs/pt/headless
462. https://code.claude.com/docs/de/headless
463. https://code.claude.com/docs/es/headless
464. https://code.claude.com/docs/id/agent-sdk/typescript
465. https://github.com/siteboon/claudecodeui/blob/main/README.md
466. https://github.com/siteboon/claudecodeui/tree/main/docker
467. https://github.com/iflow-mcp/siteboon-claudecodeui
468. https://sourceforge.net/projects/cloud-cli.mirror
469. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
470. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
471. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
472. https://nimbalyst.com/kanban-for-claude-code
473. https://github.com/xiaofengtien/claudia
474. https://github.com/AgentivX/claudia
475. https://github.com/getAsterisk/claudia
476. https://github.com/tiang/claudia
477. https://github.com/lusipad/claudia
478. https://github.com/gaiin-platform/claudia
479. https://github.com/SunnyDark/claude-code-gui
480. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
481. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
482. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
483. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
484. https://claudecn.com/en/docs/claude-code/reference/cli-reference
485. https://claude.yourdocs.dev/docs/claude-code/headless
486. https://claudecn.com/en/docs/claude-code/automation/headless
487. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
488. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
489. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
490. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
491. https://www.braingrid.ai/blog/claude-agent-sdk
492. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
493. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
494. https://github.com/anthropics/claude-code/issues/82896
495. https://github.com/anthropics/claude-code/issues/27203
496. https://github.com/anthropics/claude-code/issues/58757
497. https://github.com/anthropics/claude-code/issues/24594
498. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
499. https://code.claude.com/docs/en/changelog
500. https://code.claude.com/docs/en/debug-your-config
501. https://code.claude.com/docs/en/features-overview
502. https://code.claude.com/docs/en/how-claude-code-works
503. https://code.claude.com/docs/en/agent-sdk/streaming-output
504. https://code.claude.com/docs/en/agent-sdk/configuration
505. https://code.claude.com/docs/en/permission-modes
506. https://code.claude.com/docs/en/permissions
507. https://code.claude.com/docs/en/hooks
508. https://code.claude.com/docs/en/hooks-guide
509. https://code.claude.com/docs/en/sessions
510. https://code.claude.com/docs/en/agent-sdk/typescript
511. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
512. https://platform.claude.com/docs/en/managed-agents/reference
513. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
514. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
515. https://docs.anthropic.com/en/api/messages-streaming
516. https://anthropic.com/legal/terms
517. https://claude.ai/legal
518. https://www.anthropic.com/legal/consumer-terms
519. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
520. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
521. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
522. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
523. https://claudeapi.com/en/terms
524. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
525. https://claude.com/docs/third-party/claude-desktop/legal
526. https://code.claude.com/docs/en/legal-and-compliance
527. https://code.claude.com/docs/id/headless
528. https://code.claude.com/docs/pt/headless
529. https://code.claude.com/docs/de/headless
530. https://code.claude.com/docs/es/headless
531. https://code.claude.com/docs/id/agent-sdk/typescript
532. https://github.com/siteboon/claudecodeui/blob/main/README.md
533. https://github.com/siteboon/claudecodeui/tree/main/docker
534. https://github.com/iflow-mcp/siteboon-claudecodeui
535. https://sourceforge.net/projects/cloud-cli.mirror
536. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
537. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
538. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
539. https://nimbalyst.com/kanban-for-claude-code
540. https://github.com/xiaofengtien/claudia
541. https://github.com/AgentivX/claudia
542. https://github.com/getAsterisk/claudia
543. https://github.com/tiang/claudia
544. https://github.com/lusipad/claudia
545. https://github.com/gaiin-platform/claudia
546. https://github.com/SunnyDark/claude-code-gui
547. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
548. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
549. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
550. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
551. https://claudecn.com/en/docs/claude-code/reference/cli-reference
552. https://claude.yourdocs.dev/docs/claude-code/headless
553. https://claudecn.com/en/docs/claude-code/automation/headless
554. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
555. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
556. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
557. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
558. https://www.braingrid.ai/blog/claude-agent-sdk
559. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
560. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
561. https://github.com/anthropics/claude-code/issues/82896
562. https://github.com/anthropics/claude-code/issues/27203
563. https://github.com/anthropics/claude-code/issues/58757
564. https://github.com/anthropics/claude-code/issues/24594
565. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
566. https://code.claude.com/docs/en/changelog
567. https://code.claude.com/docs/en/debug-your-config
568. https://code.claude.com/docs/en/features-overview
569. https://code.claude.com/docs/en/how-claude-code-works
570. https://code.claude.com/docs/en/agent-sdk/streaming-output
571. https://code.claude.com/docs/en/agent-sdk/configuration
572. https://code.claude.com/docs/en/permission-modes
573. https://code.claude.com/docs/en/permissions
574. https://code.claude.com/docs/en/hooks
575. https://code.claude.com/docs/en/hooks-guide
576. https://code.claude.com/docs/en/sessions
577. https://code.claude.com/docs/en/agent-sdk/typescript
578. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
579. https://platform.claude.com/docs/en/managed-agents/reference
580. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
581. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
582. https://docs.anthropic.com/en/api/messages-streaming
583. https://anthropic.com/legal/terms
584. https://claude.ai/legal
585. https://www.anthropic.com/legal/consumer-terms
586. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
587. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
588. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
589. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
590. https://claudeapi.com/en/terms
591. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
592. https://claude.com/docs/third-party/claude-desktop/legal
593. https://code.claude.com/docs/en/legal-and-compliance
594. https://code.claude.com/docs/id/headless
595. https://code.claude.com/docs/pt/headless
596. https://code.claude.com/docs/de/headless
597. https://code.claude.com/docs/es/headless
598. https://code.claude.com/docs/id/agent-sdk/typescript
599. https://github.com/siteboon/claudecodeui/blob/main/README.md
600. https://github.com/siteboon/claudecodeui/tree/main/docker
601. https://github.com/iflow-mcp/siteboon-claudecodeui
602. https://sourceforge.net/projects/cloud-cli.mirror
603. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
604. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
605. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
606. https://nimbalyst.com/kanban-for-claude-code
607. https://github.com/xiaofengtien/claudia
608. https://github.com/AgentivX/claudia
609. https://github.com/getAsterisk/claudia
610. https://github.com/tiang/claudia
611. https://github.com/lusipad/claudia
612. https://github.com/gaiin-platform/claudia
613. https://github.com/SunnyDark/claude-code-gui
614. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
615. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
616. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
617. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
618. https://claudecn.com/en/docs/claude-code/reference/cli-reference
619. https://claude.yourdocs.dev/docs/claude-code/headless
620. https://claudecn.com/en/docs/claude-code/automation/headless
621. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
622. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
623. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
624. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
625. https://www.braingrid.ai/blog/claude-agent-sdk
626. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
627. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
628. https://github.com/anthropics/claude-code/issues/82896
629. https://github.com/anthropics/claude-code/issues/27203
630. https://github.com/anthropics/claude-code/issues/58757
631. https://github.com/anthropics/claude-code/issues/24594
632. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
633. https://code.claude.com/docs/en/changelog
634. https://code.claude.com/docs/en/debug-your-config
635. https://code.claude.com/docs/en/features-overview
636. https://code.claude.com/docs/en/how-claude-code-works
637. https://code.claude.com/docs/en/agent-sdk/streaming-output
638. https://code.claude.com/docs/en/agent-sdk/configuration
639. https://code.claude.com/docs/en/permission-modes
640. https://code.claude.com/docs/en/permissions
641. https://code.claude.com/docs/en/hooks
642. https://code.claude.com/docs/en/hooks-guide
643. https://code.claude.com/docs/en/sessions
644. https://code.claude.com/docs/en/agent-sdk/typescript
645. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
646. https://platform.claude.com/docs/en/managed-agents/reference
647. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
648. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
649. https://docs.anthropic.com/en/api/messages-streaming
650. https://anthropic.com/legal/terms
651. https://claude.ai/legal
652. https://www.anthropic.com/legal/consumer-terms
653. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
654. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
655. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
656. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
657. https://claudeapi.com/en/terms
658. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
659. https://claude.com/docs/third-party/claude-desktop/legal
660. https://code.claude.com/docs/en/legal-and-compliance
661. https://code.claude.com/docs/id/headless
662. https://code.claude.com/docs/pt/headless
663. https://code.claude.com/docs/de/headless
664. https://code.claude.com/docs/es/headless
665. https://code.claude.com/docs/id/agent-sdk/typescript
666. https://github.com/siteboon/claudecodeui/blob/main/README.md
667. https://github.com/siteboon/claudecodeui/tree/main/docker
668. https://github.com/iflow-mcp/siteboon-claudecodeui
669. https://sourceforge.net/projects/cloud-cli.mirror
670. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
671. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
672. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
673. https://nimbalyst.com/kanban-for-claude-code
674. https://github.com/xiaofengtien/claudia
675. https://github.com/AgentivX/claudia
676. https://github.com/getAsterisk/claudia
677. https://github.com/tiang/claudia
678. https://github.com/lusipad/claudia
679. https://github.com/gaiin-platform/claudia
680. https://github.com/SunnyDark/claude-code-gui
681. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
682. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
683. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
684. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
685. https://claudecn.com/en/docs/claude-code/reference/cli-reference
686. https://claude.yourdocs.dev/docs/claude-code/headless
687. https://claudecn.com/en/docs/claude-code/automation/headless
688. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
689. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
690. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
691. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
692. https://www.braingrid.ai/blog/claude-agent-sdk
693. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
694. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
695. https://github.com/anthropics/claude-code/issues/82896
696. https://github.com/anthropics/claude-code/issues/27203
697. https://github.com/anthropics/claude-code/issues/58757
698. https://github.com/anthropics/claude-code/issues/24594
699. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
700. https://code.claude.com/docs/en/changelog
701. https://code.claude.com/docs/en/debug-your-config
702. https://code.claude.com/docs/en/features-overview
703. https://code.claude.com/docs/en/how-claude-code-works
704. https://code.claude.com/docs/en/agent-sdk/streaming-output
705. https://code.claude.com/docs/en/agent-sdk/configuration
706. https://code.claude.com/docs/en/permission-modes
707. https://code.claude.com/docs/en/permissions
708. https://code.claude.com/docs/en/hooks
709. https://code.claude.com/docs/en/hooks-guide
710. https://code.claude.com/docs/en/sessions
711. https://code.claude.com/docs/en/agent-sdk/typescript
712. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
713. https://platform.claude.com/docs/en/managed-agents/reference
714. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
715. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
716. https://docs.anthropic.com/en/api/messages-streaming
717. https://anthropic.com/legal/terms
718. https://claude.ai/legal
719. https://www.anthropic.com/legal/consumer-terms
720. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
721. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
722. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
723. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
724. https://claudeapi.com/en/terms
725. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
726. https://claude.com/docs/third-party/claude-desktop/legal
727. https://code.claude.com/docs/en/legal-and-compliance
728. https://code.claude.com/docs/id/headless
729. https://code.claude.com/docs/pt/headless
730. https://code.claude.com/docs/de/headless
731. https://code.claude.com/docs/es/headless
732. https://code.claude.com/docs/id/agent-sdk/typescript
733. https://github.com/siteboon/claudecodeui/blob/main/README.md
734. https://github.com/siteboon/claudecodeui/tree/main/docker
735. https://github.com/iflow-mcp/siteboon-claudecodeui
736. https://sourceforge.net/projects/cloud-cli.mirror
737. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
738. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
739. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
740. https://nimbalyst.com/kanban-for-claude-code
741. https://github.com/xiaofengtien/claudia
742. https://github.com/AgentivX/claudia
743. https://github.com/getAsterisk/claudia
744. https://github.com/tiang/claudia
745. https://github.com/lusipad/claudia
746. https://github.com/gaiin-platform/claudia
747. https://github.com/SunnyDark/claude-code-gui
748. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
749. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
750. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
751. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
752. https://claudecn.com/en/docs/claude-code/reference/cli-reference
753. https://claude.yourdocs.dev/docs/claude-code/headless
754. https://claudecn.com/en/docs/claude-code/automation/headless
755. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
756. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
757. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
758. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
759. https://www.braingrid.ai/blog/claude-agent-sdk
760. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
761. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
762. https://github.com/anthropics/claude-code/issues/82896
763. https://github.com/anthropics/claude-code/issues/27203
764. https://github.com/anthropics/claude-code/issues/58757
765. https://github.com/anthropics/claude-code/issues/24594
766. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
767. https://code.claude.com/docs/en/changelog
768. https://code.claude.com/docs/en/debug-your-config
769. https://code.claude.com/docs/en/features-overview
770. https://code.claude.com/docs/en/how-claude-code-works
771. https://code.claude.com/docs/en/agent-sdk/streaming-output
772. https://code.claude.com/docs/en/agent-sdk/configuration
773. https://code.claude.com/docs/en/permission-modes
774. https://code.claude.com/docs/en/permissions
775. https://code.claude.com/docs/en/hooks
776. https://code.claude.com/docs/en/hooks-guide
777. https://code.claude.com/docs/en/sessions
778. https://code.claude.com/docs/en/agent-sdk/typescript
779. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
780. https://platform.claude.com/docs/en/managed-agents/reference
781. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
782. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
783. https://docs.anthropic.com/en/api/messages-streaming
784. https://anthropic.com/legal/terms
785. https://claude.ai/legal
786. https://www.anthropic.com/legal/consumer-terms
787. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
788. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
789. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
790. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
791. https://claudeapi.com/en/terms
792. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
793. https://claude.com/docs/third-party/claude-desktop/legal
794. https://code.claude.com/docs/en/legal-and-compliance
795. https://code.claude.com/docs/id/headless
796. https://code.claude.com/docs/pt/headless
797. https://code.claude.com/docs/de/headless
798. https://code.claude.com/docs/es/headless
799. https://code.claude.com/docs/id/agent-sdk/typescript
800. https://github.com/siteboon/claudecodeui/blob/main/README.md
801. https://github.com/siteboon/claudecodeui/tree/main/docker
802. https://github.com/iflow-mcp/siteboon-claudecodeui
803. https://sourceforge.net/projects/cloud-cli.mirror
804. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
805. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
806. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
807. https://nimbalyst.com/kanban-for-claude-code
808. https://github.com/xiaofengtien/claudia
809. https://github.com/AgentivX/claudia
810. https://github.com/getAsterisk/claudia
811. https://github.com/tiang/claudia
812. https://github.com/lusipad/claudia
813. https://github.com/gaiin-platform/claudia
814. https://github.com/SunnyDark/claude-code-gui
815. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
816. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
817. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
818. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
819. https://claudecn.com/en/docs/claude-code/reference/cli-reference
820. https://claude.yourdocs.dev/docs/claude-code/headless
821. https://claudecn.com/en/docs/claude-code/automation/headless
822. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
823. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
824. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
825. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
826. https://www.braingrid.ai/blog/claude-agent-sdk
827. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
828. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
829. https://github.com/anthropics/claude-code/issues/82896
830. https://github.com/anthropics/claude-code/issues/27203
831. https://github.com/anthropics/claude-code/issues/58757
832. https://github.com/anthropics/claude-code/issues/24594
833. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
834. https://code.claude.com/docs/en/changelog
835. https://code.claude.com/docs/en/debug-your-config
836. https://code.claude.com/docs/en/features-overview
837. https://code.claude.com/docs/en/how-claude-code-works
838. https://code.claude.com/docs/en/agent-sdk/streaming-output
839. https://code.claude.com/docs/en/agent-sdk/configuration
840. https://code.claude.com/docs/en/permission-modes
841. https://code.claude.com/docs/en/permissions
842. https://code.claude.com/docs/en/hooks
843. https://code.claude.com/docs/en/hooks-guide
844. https://code.claude.com/docs/en/sessions
845. https://code.claude.com/docs/en/agent-sdk/typescript
846. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
847. https://platform.claude.com/docs/en/managed-agents/reference
848. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
849. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
850. https://docs.anthropic.com/en/api/messages-streaming
851. https://anthropic.com/legal/terms
852. https://claude.ai/legal
853. https://www.anthropic.com/legal/consumer-terms
854. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
855. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
856. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
857. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
858. https://claudeapi.com/en/terms
859. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
860. https://claude.com/docs/third-party/claude-desktop/legal
861. https://code.claude.com/docs/en/legal-and-compliance
862. https://code.claude.com/docs/id/headless
863. https://code.claude.com/docs/pt/headless
864. https://code.claude.com/docs/de/headless
865. https://code.claude.com/docs/es/headless
866. https://code.claude.com/docs/id/agent-sdk/typescript
867. https://github.com/siteboon/claudecodeui/blob/main/README.md
868. https://github.com/siteboon/claudecodeui/tree/main/docker
869. https://github.com/iflow-mcp/siteboon-claudecodeui
870. https://sourceforge.net/projects/cloud-cli.mirror
871. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
872. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
873. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
874. https://nimbalyst.com/kanban-for-claude-code
875. https://github.com/xiaofengtien/claudia
876. https://github.com/AgentivX/claudia
877. https://github.com/getAsterisk/claudia
878. https://github.com/tiang/claudia
879. https://github.com/lusipad/claudia
880. https://github.com/gaiin-platform/claudia
881. https://github.com/SunnyDark/claude-code-gui
882. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
883. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
884. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
885. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
886. https://claudecn.com/en/docs/claude-code/reference/cli-reference
887. https://claude.yourdocs.dev/docs/claude-code/headless
888. https://claudecn.com/en/docs/claude-code/automation/headless
889. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
890. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
891. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
892. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
893. https://www.braingrid.ai/blog/claude-agent-sdk
894. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
895. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
896. https://github.com/anthropics/claude-code/issues/82896
897. https://github.com/anthropics/claude-code/issues/27203
898. https://github.com/anthropics/claude-code/issues/58757
899. https://github.com/anthropics/claude-code/issues/24594
900. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
901. https://code.claude.com/docs/en/changelog
902. https://code.claude.com/docs/en/debug-your-config
903. https://code.claude.com/docs/en/features-overview
904. https://code.claude.com/docs/en/how-claude-code-works
905. https://code.claude.com/docs/en/agent-sdk/streaming-output
906. https://code.claude.com/docs/en/agent-sdk/configuration
907. https://code.claude.com/docs/en/permission-modes
908. https://code.claude.com/docs/en/permissions
909. https://code.claude.com/docs/en/hooks
910. https://code.claude.com/docs/en/hooks-guide
911. https://code.claude.com/docs/en/sessions
912. https://code.claude.com/docs/en/agent-sdk/typescript
913. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
914. https://platform.claude.com/docs/en/managed-agents/reference
915. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
916. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
917. https://docs.anthropic.com/en/api/messages-streaming
918. https://anthropic.com/legal/terms
919. https://claude.ai/legal
920. https://www.anthropic.com/legal/consumer-terms
921. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
922. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
923. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
924. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
925. https://claudeapi.com/en/terms
926. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
927. https://claude.com/docs/third-party/claude-desktop/legal
928. https://code.claude.com/docs/en/legal-and-compliance
929. https://code.claude.com/docs/id/headless
930. https://code.claude.com/docs/pt/headless
931. https://code.claude.com/docs/de/headless
932. https://code.claude.com/docs/es/headless
933. https://code.claude.com/docs/id/agent-sdk/typescript
934. https://github.com/siteboon/claudecodeui/blob/main/README.md
935. https://github.com/siteboon/claudecodeui/tree/main/docker
936. https://github.com/iflow-mcp/siteboon-claudecodeui
937. https://sourceforge.net/projects/cloud-cli.mirror
938. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
939. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
940. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
941. https://nimbalyst.com/kanban-for-claude-code
942. https://github.com/xiaofengtien/claudia
943. https://github.com/AgentivX/claudia
944. https://github.com/getAsterisk/claudia
945. https://github.com/tiang/claudia
946. https://github.com/lusipad/claudia
947. https://github.com/gaiin-platform/claudia
948. https://github.com/SunnyDark/claude-code-gui
949. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
950. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
951. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
952. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
953. https://claudecn.com/en/docs/claude-code/reference/cli-reference
954. https://claude.yourdocs.dev/docs/claude-code/headless
955. https://claudecn.com/en/docs/claude-code/automation/headless
956. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
957. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
958. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
959. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
960. https://www.braingrid.ai/blog/claude-agent-sdk
961. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
962. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
963. https://github.com/anthropics/claude-code/issues/82896
964. https://github.com/anthropics/claude-code/issues/27203
965. https://github.com/anthropics/claude-code/issues/58757
966. https://github.com/anthropics/claude-code/issues/24594
967. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
968. https://code.claude.com/docs/en/changelog
969. https://code.claude.com/docs/en/debug-your-config
970. https://code.claude.com/docs/en/features-overview
971. https://code.claude.com/docs/en/how-claude-code-works
972. https://code.claude.com/docs/en/agent-sdk/streaming-output
973. https://code.claude.com/docs/en/agent-sdk/configuration
974. https://code.claude.com/docs/en/permission-modes
975. https://code.claude.com/docs/en/permissions
976. https://code.claude.com/docs/en/hooks
977. https://code.claude.com/docs/en/hooks-guide
978. https://code.claude.com/docs/en/sessions
979. https://code.claude.com/docs/en/agent-sdk/typescript
980. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
981. https://platform.claude.com/docs/en/managed-agents/reference
982. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
983. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
984. https://docs.anthropic.com/en/api/messages-streaming
985. https://anthropic.com/legal/terms
986. https://claude.ai/legal
987. https://www.anthropic.com/legal/consumer-terms
988. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
989. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
990. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
991. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
992. https://claudeapi.com/en/terms
993. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
994. https://claude.com/docs/third-party/claude-desktop/legal
995. https://code.claude.com/docs/en/legal-and-compliance
996. https://code.claude.com/docs/id/headless
997. https://code.claude.com/docs/pt/headless
998. https://code.claude.com/docs/de/headless
999. https://code.claude.com/docs/es/headless
1000. https://code.claude.com/docs/id/agent-sdk/typescript
1001. https://github.com/siteboon/claudecodeui/blob/main/README.md
1002. https://github.com/siteboon/claudecodeui/tree/main/docker
1003. https://github.com/iflow-mcp/siteboon-claudecodeui
1004. https://sourceforge.net/projects/cloud-cli.mirror
1005. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
1006. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
1007. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
1008. https://nimbalyst.com/kanban-for-claude-code
1009. https://github.com/xiaofengtien/claudia
1010. https://github.com/AgentivX/claudia
1011. https://github.com/getAsterisk/claudia
1012. https://github.com/tiang/claudia
1013. https://github.com/lusipad/claudia
1014. https://github.com/gaiin-platform/claudia
1015. https://github.com/SunnyDark/claude-code-gui
1016. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
1017. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
1018. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
1019. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
1020. https://claudecn.com/en/docs/claude-code/reference/cli-reference
1021. https://claude.yourdocs.dev/docs/claude-code/headless
1022. https://claudecn.com/en/docs/claude-code/automation/headless
1023. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
1024. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
1025. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
1026. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
1027. https://www.braingrid.ai/blog/claude-agent-sdk
1028. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
1029. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
1030. https://github.com/anthropics/claude-code/issues/82896
1031. https://github.com/anthropics/claude-code/issues/27203
1032. https://github.com/anthropics/claude-code/issues/58757
1033. https://github.com/anthropics/claude-code/issues/24594
1034. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
1035. https://code.claude.com/docs/en/changelog
1036. https://code.claude.com/docs/en/debug-your-config
1037. https://code.claude.com/docs/en/features-overview
1038. https://code.claude.com/docs/en/how-claude-code-works
1039. https://code.claude.com/docs/en/agent-sdk/streaming-output
1040. https://code.claude.com/docs/en/agent-sdk/configuration
1041. https://code.claude.com/docs/en/permission-modes
1042. https://code.claude.com/docs/en/permissions
1043. https://code.claude.com/docs/en/hooks
1044. https://code.claude.com/docs/en/hooks-guide
1045. https://code.claude.com/docs/en/sessions
1046. https://code.claude.com/docs/en/agent-sdk/typescript
1047. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
1048. https://platform.claude.com/docs/en/managed-agents/reference
1049. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
1050. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
1051. https://docs.anthropic.com/en/api/messages-streaming
1052. https://anthropic.com/legal/terms
1053. https://claude.ai/legal
1054. https://www.anthropic.com/legal/consumer-terms
1055. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
1056. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
1057. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
1058. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
1059. https://claudeapi.com/en/terms
1060. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
1061. https://claude.com/docs/third-party/claude-desktop/legal
1062. https://code.claude.com/docs/en/legal-and-compliance
1063. https://code.claude.com/docs/id/headless
1064. https://code.claude.com/docs/pt/headless
1065. https://code.claude.com/docs/de/headless
1066. https://code.claude.com/docs/es/headless
1067. https://code.claude.com/docs/id/agent-sdk/typescript
1068. https://github.com/siteboon/claudecodeui/blob/main/README.md
1069. https://github.com/siteboon/claudecodeui/tree/main/docker
1070. https://github.com/iflow-mcp/siteboon-claudecodeui
1071. https://sourceforge.net/projects/cloud-cli.mirror
1072. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
1073. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
1074. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
1075. https://nimbalyst.com/kanban-for-claude-code
1076. https://github.com/xiaofengtien/claudia
1077. https://github.com/AgentivX/claudia
1078. https://github.com/getAsterisk/claudia
1079. https://github.com/tiang/claudia
1080. https://github.com/lusipad/claudia
1081. https://github.com/gaiin-platform/claudia
1082. https://github.com/SunnyDark/claude-code-gui
1083. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
1084. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
1085. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
1086. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
1087. https://claudecn.com/en/docs/claude-code/reference/cli-reference
1088. https://claude.yourdocs.dev/docs/claude-code/headless
1089. https://claudecn.com/en/docs/claude-code/automation/headless
1090. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
1091. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
1092. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
1093. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
1094. https://www.braingrid.ai/blog/claude-agent-sdk
1095. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
1096. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
1097. https://github.com/anthropics/claude-code/issues/82896
1098. https://github.com/anthropics/claude-code/issues/27203
1099. https://github.com/anthropics/claude-code/issues/58757
1100. https://github.com/anthropics/claude-code/issues/24594
1101. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
1102. https://code.claude.com/docs/en/changelog
1103. https://code.claude.com/docs/en/debug-your-config
1104. https://code.claude.com/docs/en/features-overview
1105. https://code.claude.com/docs/en/how-claude-code-works
1106. https://code.claude.com/docs/en/agent-sdk/streaming-output
1107. https://code.claude.com/docs/en/agent-sdk/configuration
1108. https://code.claude.com/docs/en/permission-modes
1109. https://code.claude.com/docs/en/permissions
1110. https://code.claude.com/docs/en/hooks
1111. https://code.claude.com/docs/en/hooks-guide
1112. https://code.claude.com/docs/en/sessions
1113. https://code.claude.com/docs/en/agent-sdk/typescript
1114. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
1115. https://platform.claude.com/docs/en/managed-agents/reference
1116. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
1117. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
1118. https://docs.anthropic.com/en/api/messages-streaming
1119. https://anthropic.com/legal/terms
1120. https://claude.ai/legal
1121. https://www.anthropic.com/legal/consumer-terms
1122. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
1123. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
1124. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
1125. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
1126. https://claudeapi.com/en/terms
1127. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
1128. https://claude.com/docs/third-party/claude-desktop/legal
1129. https://code.claude.com/docs/en/legal-and-compliance
1130. https://code.claude.com/docs/id/headless
1131. https://code.claude.com/docs/pt/headless
1132. https://code.claude.com/docs/de/headless
1133. https://code.claude.com/docs/es/headless
1134. https://code.claude.com/docs/id/agent-sdk/typescript
1135. https://github.com/siteboon/claudecodeui/blob/main/README.md
1136. https://github.com/siteboon/claudecodeui/tree/main/docker
1137. https://github.com/iflow-mcp/siteboon-claudecodeui
1138. https://sourceforge.net/projects/cloud-cli.mirror
1139. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
1140. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
1141. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
1142. https://nimbalyst.com/kanban-for-claude-code
1143. https://github.com/xiaofengtien/claudia
1144. https://github.com/AgentivX/claudia
1145. https://github.com/getAsterisk/claudia
1146. https://github.com/tiang/claudia
1147. https://github.com/lusipad/claudia
1148. https://github.com/gaiin-platform/claudia
1149. https://github.com/SunnyDark/claude-code-gui
1150. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
1151. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
1152. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
1153. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
1154. https://claudecn.com/en/docs/claude-code/reference/cli-reference
1155. https://claude.yourdocs.dev/docs/claude-code/headless
1156. https://claudecn.com/en/docs/claude-code/automation/headless
1157. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
1158. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
1159. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
1160. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
1161. https://www.braingrid.ai/blog/claude-agent-sdk
1162. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
1163. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
1164. https://github.com/anthropics/claude-code/issues/82896
1165. https://github.com/anthropics/claude-code/issues/27203
1166. https://github.com/anthropics/claude-code/issues/58757
1167. https://github.com/anthropics/claude-code/issues/24594
1168. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
1169. https://code.claude.com/docs/en/changelog
1170. https://code.claude.com/docs/en/debug-your-config
1171. https://code.claude.com/docs/en/features-overview
1172. https://code.claude.com/docs/en/how-claude-code-works
1173. https://code.claude.com/docs/en/agent-sdk/streaming-output
1174. https://code.claude.com/docs/en/agent-sdk/configuration
1175. https://code.claude.com/docs/en/permission-modes
1176. https://code.claude.com/docs/en/permissions
1177. https://code.claude.com/docs/en/hooks
1178. https://code.claude.com/docs/en/hooks-guide
1179. https://code.claude.com/docs/en/sessions
1180. https://code.claude.com/docs/en/agent-sdk/typescript
1181. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
1182. https://platform.claude.com/docs/en/managed-agents/reference
1183. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
1184. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
1185. https://docs.anthropic.com/en/api/messages-streaming
1186. https://anthropic.com/legal/terms
1187. https://claude.ai/legal
1188. https://www.anthropic.com/legal/consumer-terms
1189. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
1190. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
1191. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
1192. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
1193. https://claudeapi.com/en/terms
1194. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
1195. https://claude.com/docs/third-party/claude-desktop/legal
1196. https://code.claude.com/docs/en/legal-andCompliance
1197. https://code.claude.com/docs/id/headless
1198. https://code.claude.com/docs/pt/headless
1199. https://code.claude.com/docs/de/headless
1200. https://code.claude.com/docs/es/headless
1201. https://code.claude.com/docs/id/agent-sdk/typescript
1202. https://github.com/siteboon/claudecodeui/blob/main/README.md
1203. https://github.com/siteboon/claudecodeui/tree/main/docker
1204. https://github.com/iflow-mcp/siteboon-claudecodeui
1205. https://sourceforge.net/projects/cloud-cli.mirror
1206. http://168.138.51.227:8088/ayhanmalkoc/claudecodeui
1207. https://github.com/Nimbalyst/nimbalyst/blob/main/README.md
1208. https://nimbalyst.com/blog/claude-code-session-kanban-organize-ai-agents
1209. https://nimbalyst.com/kanban-for-claude-code
1210. https://github.com/xiaofengtien/claudia
1211. https://github.com/AgentivX/claudia
1212. https://github.com/getAsterisk/claudia
1213. https://github.com/tiang/claudia
1214. https://github.com/lusipad/claudia
1215. https://github.com/gaiin-platform/claudia
1216. https://github.com/SunnyDark/claude-code-gui
127. https://claude-code-sdk.hexdocs.pm/ClaudeCodeSDK.Message.html
1218. https://pkg.go.dev/github.com/spacingmind/claude-agent-sdk-go@v0.3.3
1219. https://pkg.go.dev/github.com/xhd2015/agent-pro/agent/cli/claude@v0.0.184
1220. https://pkg.go.dev/github.com/maruel/genai/providers/claudecode
1221. https://claudecn.com/en/docs/claude-code/reference/cli-reference
1222. https://claude.yourdocs.dev/docs/claude-code/headless
1223. https://claudecn.com/en/docs/claude-code/automation/headless
1224. https://smithery.ai/skills/0xDarkMatter/claude-code-headless
1225. https://github.com/pleaseai/claude-code-docs/blob/main/docs/agent-sdk/permissions.md
1226. https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-agent-sdk/typescript/README.md
1227. https://www.npmjs.com/package/@botanicastudios/claude-code-sdk-ts
1228. https://www.braingrid.ai/blog/claude-agent-sdk
1229. https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts
1230. https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md
1231. https://github.com/anthropics/claude-code/issues/82896
1232. https://github.com/anthropics/claude-code/issues/27203
1233. https://github.com/anthropics/claude-code/issues/58757
1234. https://github.com/anthropics/claude-code/issues/24594
1235. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
1236. https://code.claude.com/docs/en/changelog
1237. https://code.claude.com/docs/en/debug-your-config
1238. https://code.claude.com/docs/en/features-overview
1239. https://code.claude.com/docs/en/how-claude-code-works
1240. https://code.claude.com/docs/en/agent-sdk/streaming-output
1241. https://code.claude.com/docs/en/agent-sdk/configuration
1242. https://code.claude.com/docs/en/permission-modes
1243. https://code.claude.com/docs/en/permissions
1244. https://code.claude.com/docs/en/hooks
1245. https://code.claude.com/docs/en/hooks-guide
1246. https://code.claude.com/docs/en/sessions
1247. https://code.claude.com/docs/en/agent-sdk/typescript
1248. https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless
1249. https://platform.claude.com/docs/en/managed-agents/reference
1250. https://platform.claude.com/docs/en/api/beta/sessions/events/stream
1251. https://platform.claude.com/docs/en/api/cli/beta/sessions/events/stream
1252. https://docs.anthropic.com/en/api/messages-streaming
1253. https://anthropic.com/legal/terms
1254. https://claude.ai/legal
1255. https://www.anthropic.com/legal/consumer-terms
1256. https://www.anthropic.com/legal/archive/81827a94-9440-4015-ad33-da6d7c1d8a32
1257. https://www.anthropic.com/legal/archive/d1642ca5-a466-4326-ac3d-a9de6e60e627
1258. https://www.anthropic.com/legal/archive/80e847ae-5c9e-4a7b-b2cb-88895aa972d5
1259. https://www.anthropic.com/legal/archive/63888185-843f-445e-abe3-4f0cb047d118
1260. https://claudeapi.com/en/terms
1261. https://docs.claude.com/en/docs/claude-code/legal-and-compliance
1262. https://claude.com/docs/third-party/claude-desktop/legal
1263. https://code.claude.com/docs/en/legal-and-compliance
1264. https://code.claude.com/docs/id/headless
1265. https://code.claude.com/docs/pt/headless
1266. https://code.claude.com/docs/de/headless
1267. https://code.claude.com/docs/es/headless
1268. https://code.claude.com/docs/id/agent-sdk/typescript
1269. https://github.com/siteboon/claudecodeui/blob/main/README.md
1270. https://github.com/siteboon/claudecodeui/tree/main/docker
1271. https://github.com/iflow-mcp/siteboon-claudecodeui
1272. https://sourceforge.net/projects/cloud-cli.mirror
1273. http://168.138.51.227:8088/ayhan
