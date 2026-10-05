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
- [ ] **T2 — Multi-project selector** (route: delegated, DeepSeek builder; writer trigger: server + UI + tests). Monitor config gets a `projects` list (name, repo, kitConfig); header dropdown switches the project; server serves the selected project's state; tests cover selection.

## Progress / evidence

- T1 done in commit `0e592ca`. `node --test` in `monitor/`: 105 pass, 0 fail. Three tests were bound to FlotaGrupo (folder name `fleet-monitor`, git-ignored shipped config) and now read the example config and the `monitor` folder. Monitor launched with `monitor/start.ps1 -ConfigPath .korsakov/monitor.config.json`; `GET /` → 200, `/api/state` shows this repo's git log.
- Local layout (git-ignored `.korsakov/`): `monitor.config.json` (port 4202), `kit.config.json` (tracks), `runs/` (builder status and reports), `status-<track>.json` (the monitor reads status files from the kit config folder, NOT from `runs/`; currently a hard link).
- T2 dispatched 2026-10-05 ~20:53 (-03:00): worktree `../Korsakov Orchestrator-worktrees/monitor-projects`, branch `builder/monitor-projects`, brief in that worktree's `.korsakov/brief.md`, runner `docs/scripts/oc-run.ps1` (agent build, deepseek-v4.1-flash max, attached to `:4096`). Visible on the monitor as "trabajando".
- Review tier per task: T1 verbatim import, RDD not assessed yet (no review run).

## Next step

Wait for T2, review its diff, run `node --test`, then merge into `main` with the user's OK and restart the monitor.
