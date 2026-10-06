# Stage 1 — Standalone monitor

## Objective

Bring the fleet monitor (FlotaGrupo `tools/fleet-monitor`, branch `bench/bench-deepseek` @ `d635ed62`) into Korsakov Orchestrator as an independent app, keep it running while we build, and grow it into the multi-project general monitor (see `docs/arquitectura-y-plan.md`, stage 1).

## Problem / why

The monitor lives inside the FlotaGrupo repo and is wired to its autopilot kit. Korsakov needs its own copy that watches any project, starting with this repository, so the user can keep watching builders while Korsakov is built.

## Scope

- In: copy of the monitor app under `monitor/`, machine-local config under `.korsakov/` (git-ignored), multi-project selector.
- Out (later stages): chat panel, orchestrator selector, project init command.

## Constraints

- No pushes, no PRs, no merges into `main` without the user.
- Builders: OpenCode `opencode-go/deepseek-v4.1-flash` (variant max) in `../Korsakov Orchestrator-worktrees/<slug>`, attached to the shared OpenCode server `:4096` so the monitor sees them. Claude reviews every diff.
- Monitor port for Korsakov: `4202` (`4200` = FlotaGrupo monitor, `4201` = demo).

## Checks

- TDD: off (source: no project/session configuration; user did not request it). Runner: `node --test` inside `monitor/`.
- Applicable checks per task: `node --test` in `monitor/` green; monitor answers on `http://127.0.0.1:4202/`.

## Delivery

- Strategy: `ask-on-risk` (default). Forecast: T1 is a verbatim import (~2,000 lines, not authored); T2 about 300–400 authored lines.

## Tasks

- [x] **T1 — Import and launch** (route: inline, mechanical copy; no delegation trigger: no new design, no non-trivial authored files). `git init`, copy the monitor without its local cache/config, local config pointing at this repo, run tests, launch on `:4202`.
- [x] **T2 — Multi-project selector** (route: delegated, DeepSeek builder; writer trigger: server + UI + tests). Monitor config gets a `projects` list (name, repo, kitConfig); header dropdown switches the project; server serves the selected project's state; tests cover selection.

## Progress / evidence

- T1 done in commit `0e592ca`. `node --test` in `monitor/`: 105 pass, 0 fail. Three tests were bound to FlotaGrupo (folder name `fleet-monitor`, git-ignored shipped config) and now read the example config and the `monitor` folder. Monitor launched with `monitor/start.ps1 -ConfigPath .korsakov/monitor.config.json`; `GET /` → 200, `/api/state` shows this repo's git log.
- Local layout (git-ignored `.korsakov/`): `monitor.config.json` (port 4202), `kit.config.json` (tracks), `runs/` (builder status and reports), `status-<track>.json` (the monitor reads status files from the kit config folder, NOT from `runs/`; currently a hard link).
- T2 dispatched 2026-10-05 ~20:53 (-03:00): worktree `../Korsakov Orchestrator-worktrees/monitor-projects`, branch `builder/monitor-projects`, brief in that worktree's `.korsakov/brief.md`, runner `docs/scripts/oc-run.ps1` (agent build, deepseek-v4.1-flash max, attached to `:4096`). Visible on the monitor as "trabajando".
- Review tier per task: T1 verbatim import, RDD not assessed yet (no review run).
- T2 builder finished (exit 0): commits `ca3ab77` (backend + tests) and `01c6691` (header selector + docs) on `builder/monitor-projects`; 9 files, +426/-22. `node --test` re-run by Claude in the worktree: 114 pass, 0 fail. Builder also ran a two-project HTTP smoke test (no cache bleed, unknown id → 404). Claude read the backend and client diff: matches the brief; `lib/translate.mjs` was touched only to key worker summaries by project id (in the spirit of "no cross-project data"). `.atl/` added to the repo's `info/exclude`.
- T2 RDD: `gentle-ai review assess` → medium, `review_due=true` (`slice_budget_reached`, 448 lines). START returned the consent envelope; the user chose to turn RDD off for now (`gentle-ai review mode disable` → global off, 2026-10-05). No native review for T2; verification of record = builder tests + Claude re-run (114/114) + Claude diff read. Merge into `main` still waits for the user's OK.
- Side track (not a task of this feature): LongCat research "live view of the files an agent touches" dispatched 2026-10-05 ~21:04, brief `.korsakov/research/live-file-view/brief.md`, report to `.korsakov/runs/research-live-file-view.report.md`, then to `docs/investigaciones/13-vista-en-vivo-de-archivos.md`.

- T2 merged into `main` as `2ae4835` (user OK + permissions, 2026-10-05). `node --test` on main: 114/114. Monitor restarted hidden without opening a tab (`node server.mjs .korsakov/monitor.config.json`). Local config now lists two projects: `korsakov` and `flota` (FlotaGrupo repo + its autopilot kit).
- Fix: `~/.claude/quota/claude-usage.json` had a UTF-8 BOM (written by `Set-Content -Encoding utf8` in PowerShell 5.1), so the monitor showed "no se pudo leer claude-usage.json". Rewritten without BOM. Always write that file BOM-less.
- Experiment (uncommitted, waiting for the user's verdict): film-style typography — `h1` in Times capitals, wide tracking, sliced by horizontal lines; digital rain with mirrored half-width katakana + digits.

## Next step

Wait for T2, review its diff, run `node --test`, then merge into `main` with the user's OK and restart the monitor.

- Fix: the monitor died when the agent shell that started it ended (`Start-Process` child is cleaned up with the caller). `monitor/start.ps1` now creates the server through WMI (`Win32_Process.Create`, parent `WmiPrvSE`) and accepts `-NoBrowser`. Start with: `monitor/start.ps1 -ConfigPath .korsakov/monitor.config.json -NoBrowser`.
