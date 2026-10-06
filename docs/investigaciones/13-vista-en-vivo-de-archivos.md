# Informe de investigación: Vista en vivo de archivos que el agente está tocando

## 1. Obtener el contenido mientras se escribe

### Claude Code headless
**Verificado.** `claude -p "..." --output-format stream-json --verbose --include-partial-messages` emite NDJSON por stdout. Los eventos `content_block_delta` con `delta.type == "input_json_delta"` transmiten el JSON parcial de la entrada de herramientas (`partial_json`) incrementalmente. Eventos clave: `content_block_start` (inicio de tool_use), `content_block_delta` (chunks de `partial_json`), `content_block_stop` (tool call completo). El transcript en `~/.claude/projects/` NO contiene `stream_event` — solo el stream JSONL en vivo los tiene. Fuente: [docs de Claude Code headless](https://code.claude.com/docs/en/headless), [Agent SDK streaming-output](https://code.claude.com/docs/en/agent-sdk/streaming-output.md).

### OpenCode
**Verificado.** `opencode serve` expone `GET /event` (SSE). Los eventos `message.part.updated` con `part.state.input` contienen la entrada de la herramienta. Sin embargo, **bugs recientes** (issues #27966, #46733 en GitHub de anomalyco/opencode) reportan que `message.part.updated` no llega a los suscriptores SSE en versiones 1.14.42+ y 1.18.25, aunque el servidor los publica internamente. El evento `message.part.delta` sí funciona para texto. Fuente: [OpenCode server docs](https://opencode.ai/docs/server/), [issue #27966](https://github.com/anomalyco/opencode/issues/27966), [issue #46733](https://github.com/anomalyco/opencode/issues/46733).

### Codex CLI
**Verificado.** `codex exec --json` emite JSONL. Los items `file_change` solo aparecen como `item.completed` — **no hay streaming del diff**. El item contiene `changes[].path`, `changes[].kind` (add/update/delete), y `status`. Para streaming de apply_patch, existe el evento `PatchApplyUpdated` en el app-server (PR #17862, #18289 en openai/codex), pero `codex exec --json` estándar no lo expone. Fuente: [Codex app-server docs](https://developers.openai.com/codex/app-server.md), [PR #17862](https://github.com/openai/codex/pull/17862), [cheatsheet](https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/).

### Antigravity agy
**Verificado.** `agy -p --output-format stream-json` emite NDJSON con eventos `init`, `step_update`, `result`. Los pasos `tool` con `state: DONE` incluyen `tool_info` con `name`, `parameters` (incluye rutas de archivo como `TargetFile`, `AbsolutePath`), y `output`. **No hay streaming incremental de los parámetros** — `tool_info` llega completo en el paso DONE. Fuente: [Antigravity headless docs](https://antigravity.google/docs/cli/headless/), [CHANGELOG](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md).

### Fallback: fs.watch + git diff
**Verificado.** `chokidar` (wrapper sobre `fs.watch`) con `awaitWriteFinish: true` detecta escrituras completas. Combinado con `git diff --numstat` y `git status --short` se obtiene el estado del worktree. Limitaciones en Windows: `fs.watch` nativo tiene problemas con `EPERM` (issue #4337 de Node.js), y los watchers recursivos consumen muchos handles. `git config core.useBuiltinFSMonitor true` (Git for Windows) acelera `git status` pero no emite eventos. Fuente: [chokidar README](https://github.com/paulmillr/chokidar/blob/main/README.md), [DeepWiki chokidar](https://deepwiki.com/microsoft/chokidar/6.2-linuxwindows-(fs.watch)), [git-fsmonitor docs](https://git-scm.com/docs/git-fsmonitor--daemon).

## 2. Productos existentes

| Producto | Qué muestra | Código abierto | Licencia |
|----------|-------------|----------------|----------|
| **Cline/Roo Code** | Diff view con animación de streaming simulada (el SDK solo entrega input completo) | Sí ([github.com/cline/cline](https://github.com/cline/cline)) | Apache-2.0 |
| **siteboon/claudecodeui** | File explorer con live editing, diff cards, git explorer | Sí ([github.com/siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)) | AGPL-3.0 |
| **d-kimuson/claude-code-viewer** | Session log viewer con explorer de archivos editados | Sí ([github.com/d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer)) | MIT |
| **terryso/cc-live** | Viewer SSE para sesiones Claude Code con rendering de diffs | Sí ([github.com/terryso/cc-live](https://github.com/terryso/cc-live)) | — |
| **mrexodia/agent-viewer** | Watcher JSONL con latencia <500ms, multi-agente | Sí ([github.com/mrexodia/agent-viewer](https://github.com/mrexodia/agent-viewer)) | — |
| **Milad-Afdasta/REPO-VISUALIZER** | Treemap estilo defrag: archivos se iluminan al leer/editar/crear/borrar | Sí ([github.com/Milad-Afdasta/REPO-VISUALIZER](https://github.com/Milad-Afdasta/REPO-VISUALIZER)) | — |
| **AgentWatch** (Reddit r/LLMDevs) | Treemap 2D squarified, live diff stream, file mind map | No | — |
| **Cursor/Windsurf** | Agent panel con file tree y diffs | No | — |

**Hallazgo clave**: Roo Code **simula** la animación de streaming porque "the SDK only surfaces complete tool input" (commit `2ac5c85`). Esto confirma que el streaming token-by-token del contenido de archivos solo está disponible en Claude Code (vía `input_json_delta`).

## 3. Bloques de UI para vanilla JS + CDN

### Resaltado de sintaxis
| Librería | Tamaño (gzip) | Velocidad | CDN ESM | Notas |
|----------|---------------|-----------|---------|-------|
| **Prism** | ~12 KB | 0.5-0.7 ms/doc | Sí (jsdelivr) | El más rápido, gramáticas maduras |
| **highlight.js** | ~16 KB | 1.1-1.4 ms/doc | Sí | Auto-detección de lenguaje |
| **Shiki** | ~280 KB | 3.5-5.0 ms/doc | Sí (esm.sh) | Calidad VS Code, WASM, pesado |
| **CodeMirror 6** | ~100 KB+ | — | Requiere import maps | Editor completo, no solo highlight |
| **Monaco** | ~1 MB+ | — | No oficial (monaco-editor-esm-cdn) | Demasiado pesado para este uso |

**Recomendación**: Prism o highlight.js para resaltado estático. Shiki solo si se prefiere calidad VS Code y se acepta el costo. CodeMirror 6 si se necesita un editor interactivo (con import maps vía esm.sh). Fuente: [comparativa chsm.dev](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters), [Shiki bundles](https://shiki.style/guide/bundles), [CodeMirror CDN](https://discuss.codemirror.net/t/esm-compatible-codemirror-build-directly-importable-in-browser/5933).

### Mapa de archivos
- **D3.js** (tree, treemap, force graph): disponible como ESM en jsdelivr (`https://cdn.jsdelivr.net/npm/d3@7/+esm`). Treemap squarified para visualizar actividad por archivo. Collapsible tree para navegación. Fuente: [D3 getting started](https://d3js.org/getting-started), [d3-hierarchy README](https://github.com/d3/d3-hierarchy/blob/v3.1.1/README.md).
- **TreeForge**: componente vanilla JS de ~10 KB, sin dependencias, con 15 temas. Fuente: [TreeForge](https://abmercy035.github.io/treeforge/).

## 4. Diseño recomendado

### Flujo de datos
```
Adapter (stream-json / SSE / JSONL)
  → Parser (extrae file_path + content chunks)
  → Servidor (normaliza a eventos unificados: {agent, file, action, content_chunk})
  → SSE al browser
  → UI (file tree + code panel con append incremental)
```

### Estrategia por agente
- **Claude Code**: streaming real vía `input_json_delta`. Acumular `partial_json` y parsear al `content_block_stop`.
- **OpenCode**: SSE `message.part.updated` con fallback a polling de `GET /session/:id/message` si el SSE falla.
- **Codex CLI**: `codex exec --json` da solo `item.completed`. Usar fallback fs.watch + git diff para streaming simulado.
- **Antigravity**: `tool_info` en DONE. Fallback a transcript JSONL (`~/.gemini/antigravity-cli/brain/`) para contenido completo.

### Throttling y memoria
- Debounce de 100-200 ms en eventos de archivo (patrón usado en Grok-UI y spec-kimi-code).
- Buffer circular por archivo: últimos N chunks (ej. 10 KB), no el archivo completo.
- Enviar al browser solo diffs incrementales, no el archivo completo.
- Límite de archivos simultáneos por agente (ej. 20).

### Versión mínima vs completa
**Mínima (1-2 días)**: File tree plano (lista de rutas) + panel de texto con append. Solo Claude Code con streaming real. Polling de 5s como fallback.

**Completa (5-7 días)**: Tree colapsable con D3, resaltado con Prism, streaming para los 4 agentes, throttling, multi-agente con pestañas.

## 5. Experiencia de la comunidad

- **Reddit r/ClaudeCode** (marzo 2026): usuarios reportan que "ver los bloques y las lecturas de archivos en real-time hace mucho más fácil confiar en el modo autónomo". La opacidad es un problema real de confianza.
- **Reddit r/LLMDevs** (marzo 2026): AgentWatch construido específicamente para "ver dónde está trabajando el agente" con treemap 2D.
- **GitHub issues de OpenCode**: bugs SSE recurrentes (#27966, #46733) muestran que el streaming de eventos de herramientas es frágil en producción.
- **Cline discussion #2551**: la animación de diff streaming consume CPU significativa en archivos grandes por las decoraciones de editor.
- **spec-kimi-code**: implementa `FsWatcherService` con debounce configurable y límite de cambios por ventana para evitar inundar el stream.

## Fuentes abiertas

1. https://code.claude.com/docs/en/headless
2. https://code.claude.com/docs/en/agent-sdk/streaming-output.md
3. https://opencode.ai/docs/server/
4. https://github.com/anomalyco/opencode/issues/27966
5. https://github.com/anomalyco/opencode/issues/46733
6. https://developers.openai.com/codex/app-server.md
7. https://github.com/openai/codex/pull/17862
8. https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/
9. https://antigravity.google/docs/cli/headless/
10. https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md
11. https://github.com/cline/cline/discussions/2551
12. https://github.com/RooCodeInc/Roo-Code/commit/2ac5c85
13. https://github.com/siteboon/claudecodeui
14. https://github.com/d-kimuson/claude-code-viewer
15. https://github.com/terryso/cc-live
16. https://github.com/mrexodia/agent-viewer
17. https://github.com/Milad-Afdasta/REPO-VISUALIZER
18. https://www.reddit.com/r/LLMDevs/comments/1s7ay21/
19. https://www.reddit.com/r/ClaudeCode/comments/1s0my59/
20. https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters
21. https://shiki.style/guide/bundles
22. https://discuss.codemirror.net/t/esm-compatible-codemirror-build-directly-importable-in-browser/5933
23. https://d3js.org/getting-started
24. https://github.com/d3/d3-hierarchy/blob/v3.1.1/README.md
25. https://github.com/paulmillr/chokidar/blob/main/README.md
26. https://deepwiki.com/microsoft/chokidar/6.2-linuxwindows-(fs.watch)
27. https://git-scm.com/docs/git-fsmonitor--daemon
28. https://github.com/joeynyc/Grok-UI/blob/ac2e1d91/server/workspace-inspector.ts
29. https://github.com/xy200303/spec-kimi-code/blob/main/packages/agent-core-v2/src/session/sessionFs/fsWatchService.ts
30. https://github.com/hatemhosny/monaco-editor-esm-cdn
31. https://abmercy035.github.io/treeforge/
