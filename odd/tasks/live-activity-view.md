# Live activity view

## Objective

Turn the monitor's one-line activity log into a step-by-step replay of what each AI agent does: code being typed, a mini terminal, memory cards, media, and a drawn folder map. All of it themeable (Matrix is the first theme).

## Problem / why

Today the server shrinks every agent step to one line (`EDIT path`) and drops the content. The user wants to SEE the work: the file being written, the command and its output, what was saved to memory, the image or video produced, and where in the tree the agent is working.

## References

- Requirements: `docs/vista-en-vivo.md`, `docs/temas.md`.
- Research: `docs/investigaciones/13-vista-en-vivo-de-archivos.md` (real streaming only for Claude Code launched by Korsakov; everything else is replayed with a simulated typing animation, like Roo Code).
- Decisions: `docs/decisiones.md` D9 (localhost only).

## Scope

- In: `monitor/` only (server, adapters, `index.html`, tests, README).
- Out: chat panel (stage 2), real token streaming, desktop wrapper.

## Constraints

- No model calls for the live view (pure programming). The existing translation of git commits stays.
- No new runtime dependencies on the server. Browser libraries (Prism, D3) bundled locally under `monitor/public/`, never loaded from the internet at runtime.
- Every color, font and effect through theme tokens.
- API answers only its own page (Host/Origin check); files only from registered worktrees.

## Checks

- TDD: off (no project/session configuration). Runner: `node --test` inside `monitor/`.
- Per task: `node --test` green; Claude reviews the diff; Claude loads the page on `:4202` and checks it visually.
- RDD: off globally by the user (2026-10-05); no native review.

## Delivery

- No git remote: no PRs. Each task is built by a DeepSeek builder (OpenCode `deepseek-v4.1-flash`, variant max) in `../Korsakov Orchestrator-worktrees/<slug>`, reviewed by Claude, merged into `main` with `--no-ff` and the monitor restarted (`start.ps1 -NoBrowser`), so the user can try each step. The user gave execution permission on 2026-10-05.
- Forecast: about 1,400 authored lines across 4 tasks, roughly 350 each. Chain strategy for PRs does not apply (no remote).

## Tasks

- [x] **T1 â€” Themes** (route: delegated, builder `monitor-themes`; writer trigger: `index.html` + `graph.mjs` + tests). Tokens for every color/font/effect, `data-theme`, Matrix theme block (current palette + film typography), theme selector in the header, background module registry with the rain as Matrix's background and an on/off switch, branch palette by index, placeholder tokens for code and ANSI colors, guard test against hard-coded colors.
- [x] **T2 â€” Full steps API + same-origin guard** (route: delegated, builder `monitor-steps`; writer trigger: adapters + state + server + tests). Adapters for OpenCode and Claude Code return full typed steps (edit, write, read, command, memory, tool, message); `GET /api/steps`; Host/Origin guard on every route. Codex and Antigravity steps later (T2b).
- [x] **T3a â€” Panel and code viewers** (route: delegated, builder `monitor-viewer`).
- [ ] **T3b â€” Mini terminal and memory card** (route: delegated, builder `monitor-terminal`).
- [ ] **T2b â€” Codex and Antigravity steps** (route: delegated, builder `monitor-steps-more`).
- [ ] **T3 (original line, kept for history) â€” Panel and text viewers** (after T1 + T2). Collapsible windows with tabs colored by state; code sheet with typing animation and edit beforeâ†’after; mini terminal; memory card; generic tool card.
- [ ] **T4 â€” Media, files and map** (after T3). Safe file endpoint; image/video "being built" animated icon then the result; PDF in the same tab; binary info card with copy path and "open in Explorer"; D3 folder map lit by read/edit/create/delete.

## Progress / evidence

- T2: builder commits `577baef`, `048a55a`, `421ff0f` (new `lib/steps.mjs`, `mapOpenCodeSteps`, `mapClaudeSteps`, `buildWorkerSteps`, `GET /api/steps`, `isAllowedRequest` Host/Origin guard, nosniff via `send()`); ~660 authored lines (over the 400 heuristic: two adapters + guard + test matrix). Claude review: guard logic correct (exact Host `127.0.0.1:<port>`/`localhost:<port>`, Origin same-origin or absent). Claude fix `315e107`: the binary detector treated ESC (0x1B) as binary and wiped ANSI-colored command output; ESC now allowed, regression test added. Merged into `main` (`--no-ff`); `node --test` 125/125. Live probe on `:4202`: 78 real steps for `monitor-steps` (edit 17, read 16, command 15, message 14, memory 8, write 7, tool 1); foreign `Origin` â†’ 403.
- T1: builder commits `3618b08` (`branchColorIndex`, `laneColorIndexes`) and `915cc87` (token blocks `:root` fallback + `:root[data-theme="matrix"]` with state/branch/code/ANSI groups, `THEMES` + `TEMA` select, `FONDO` toggle, head inline theme script, `BACKGROUNDS` registry, canvas colors from tokens, README "Temas"); +596/-109 (the `:root` fallback duplicates the Matrix block by design). Builder verified with headless Chrome: 25 computed-style probes identical to the old page. Merged into `main` cleanly after T2; `node --test` 133/133; page checked on `:4202` (TEMA Matrix, FONDO ON, rain, title).
- T3a: builder commits `9be6d2d` (`public/js/live-view.mjs` 819 lines: tab keying + 12 cap, typing plan, catch-up, built-in highlighter for 8 language families, DOM behind `init()`), `aa8cdbc` (`/js/` static route), `7a189b0` (cards attach the viewer; CSP `script-src 'self' 'unsafe-inline'`), `3e58ced` (README). ~1,275 insertions (engine + viewers + highlighter + tests in one task). Claude review: no `innerHTML`/`eval`/`new Function` in the module; CSP still `default-src 'none'`. Merged; `node --test` 144/144. Live check by Claude on `:4202` with real builder history: VER opens the viewer, replay catches up to the latest 12 tabs within ~10 s, a memory save card typed its title and content, viewer survives the 5 s state refresh.
- Known limit: the steps cache keeps up to 300 steps Ã— 200,000 chars per worker in memory; fine for now, revisit if many workers run at once.

## Next step

T1 and T2 in parallel (independent files except a small overlap in `lib/state.mjs`).
- User feedback on T3a (2026-10-05): the viewer grew and shrank while steps played, and the scroll stayed at the top while text was typed. Claude fix on `main`: fixed viewer size (tab strip 62 px = three rows, scrolls past that; body 200 px; no nested max-height on code blocks) and stick-to-bottom scrolling (follows the typing; scrolling up pauses it; switching tab re-enables it). Measured in the browser: viewer constant at 269 px over 4 s of replay, body always at the bottom. Expect a merge conflict with T3b in `index.html`/`live-view.mjs`.
- User feedback 2: when the viewer was idle the scroll jumped to the top and came back down when typing resumed. Cause: every 5 s `renderWorkers` removes the cards and builds new ones; `attach()` moves the viewer into the new card while it is still detached, and moving a scroll container resets `scrollTop` to 0 without a scroll event. Fix: save `scrollTop` on user scrolls; after `attach` restore it (or stick to the bottom) in a microtask plus a `setTimeout(0)` pass, ignoring scroll events meanwhile. `requestAnimationFrame` was rejected: it does not run in hidden tabs. Verified in the browser over two refreshes: stuck at bottom 700/700 every sample; a user position of 100 kept at 100.
- User feedback 3: a tab sometimes froze on "escribiendoâ€¦" until the page was reloaded. Cause: the viewer polled with `since=<last id>`, so a step first seen while still running (no content yet) was never delivered again when it finished. Fix: `pollSince()` asks from the step before the first still-running one, and `stepSignature()` replays a re-delivered step only when its status/data changed (finished steps replace their "escribiendoâ€¦" block). Known ids capped at 400. Tests added (146/146).
- T3b: builder commits `4cdde84` (`parseAnsi`/`ansi256To16`/`ansiLines`/`capTerminalLines`, terminal/memory/tool viewers, `VIEWERS` registry, `splitToolName`, `memoryResultRows`) and `6364979` (README); +931 lines. Builder manual check in headless Chrome with 7 screenshots (colored output, exit codes, blinking cursor, memory save/search, tool card). Merged as `e678f30`; conflict only in the test imports. In the merge Claude also: added `followBottom` to the three new typing loops (they did not follow the scroll) and removed the nested `max-height`/`overflow` from `.term-output`-style blocks and `.mem-pre` (single scroll container rule). `node --test` 155/155.
- T2b: builder commit `1182a13` (`mapCodexSteps` normalizing `codex exec --json` items, rollout `response_item`/`event_msg` and bare items, `apply_patch` → write/edit/tool, Engram → memory; `mapAntigravitySteps` for view_file/write_to_file/replace_file_content/run_command/call_mcp_tool; shared `hashId`). Real samples: Codex 16 steps (command 7, memory 4, tool 3, message 2); agy 42 and 50 steps. Caveat: real agy stream-json carries only paths/command lines, no file content, so agy write/edit show the path without text. Merged; `node --test` 163/163; server restarted through the supervisor.
- Monitor went down once with no logs (cause unknown; no builder command killed it). `monitor/supervise.ps1` (commit `75c78d3`) now runs the server with stdout/stderr appended to `.korsakov/monitor.*.log`, logs every exit and restarts it. Restart after server changes = stop the node process; the supervisor brings it back in ~2 s.
