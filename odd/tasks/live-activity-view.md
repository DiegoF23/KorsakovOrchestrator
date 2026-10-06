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

- [ ] **T1 — Themes** (route: delegated, builder `monitor-themes`; writer trigger: `index.html` + `graph.mjs` + tests). Tokens for every color/font/effect, `data-theme`, Matrix theme block (current palette + film typography), theme selector in the header, background module registry with the rain as Matrix's background and an on/off switch, branch palette by index, placeholder tokens for code and ANSI colors, guard test against hard-coded colors.
- [x] **T2 — Full steps API + same-origin guard** (route: delegated, builder `monitor-steps`; writer trigger: adapters + state + server + tests). Adapters for OpenCode and Claude Code return full typed steps (edit, write, read, command, memory, tool, message); `GET /api/steps`; Host/Origin guard on every route. Codex and Antigravity steps later (T2b).
- [ ] **T3 — Panel and text viewers** (after T1 + T2). Collapsible windows with tabs colored by state; code sheet with typing animation and edit before→after; mini terminal; memory card; generic tool card.
- [ ] **T4 — Media, files and map** (after T3). Safe file endpoint; image/video "being built" animated icon then the result; PDF in the same tab; binary info card with copy path and "open in Explorer"; D3 folder map lit by read/edit/create/delete.

## Progress / evidence

- T2: builder commits `577baef`, `048a55a`, `421ff0f` (new `lib/steps.mjs`, `mapOpenCodeSteps`, `mapClaudeSteps`, `buildWorkerSteps`, `GET /api/steps`, `isAllowedRequest` Host/Origin guard, nosniff via `send()`); ~660 authored lines (over the 400 heuristic: two adapters + guard + test matrix). Claude review: guard logic correct (exact Host `127.0.0.1:<port>`/`localhost:<port>`, Origin same-origin or absent). Claude fix `315e107`: the binary detector treated ESC (0x1B) as binary and wiped ANSI-colored command output; ESC now allowed, regression test added. Merged into `main` (`--no-ff`); `node --test` 125/125. Live probe on `:4202`: 78 real steps for `monitor-steps` (edit 17, read 16, command 15, message 14, memory 8, write 7, tool 1); foreign `Origin` → 403.
- Known limit: the steps cache keeps up to 300 steps × 200,000 chars per worker in memory; fine for now, revisit if many workers run at once.

## Next step

T1 and T2 in parallel (independent files except a small overlap in `lib/state.mjs`).
