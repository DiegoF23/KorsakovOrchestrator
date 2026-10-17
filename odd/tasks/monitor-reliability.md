# Monitor reliability: translations, large-kit speed, orphaned workers

## Objective

Make the fleet monitor trustworthy for big projects like FlotaGrupo: commit
translations work again, the state of a project with many agents loads fast,
and a worker whose runner died is resolved as done or error instead of staying
"sin reporte reciente" forever.

## Problems (verified 2026-10-16)

1. **Translations stopped on 2026-10-06.** `translate.model` defaults to
   `opencode-go/space-bunny-free`, which no longer exists (`opencode models
   opencode-go` lists `space-bunny`, `beam-free`, `longcat-2.5-preview-free`).
   `monitor/translations.json` was last written 2026-10-06.
2. **`/api/state?project=flota` takes over a minute.** `buildWorkers`
   (`monitor/lib/state.mjs:1122`) awaits each worker in sequence; flota has 83
   visible OpenCode workers and each one costs ~0.85 s of OpenCode HTTP calls.
   `memo` (`state.mjs:1487`) has no in-flight dedupe, so 5 s polls stack.
3. **Orphaned worker shown as stale forever.** `status-spec-draft.json` says
   `running`, pid 30444, last update 2026-10-13T14:32:17. Windows reused pid
   30444 for `RadeonSoftware.exe` (started 2026-10-16 08:13), so `isPidAlive`
   says alive and `workerState` returns `stale`. The agent had finished (commit
   `7bac3369`, todo 7/7, last message "Listo, Sr.").

## Scope and decisions

- Translation default moves to `opencode-go/longcat-2.5-preview-free` (the
  user's free "sabueso"), in code, example config, README and the local config.
- `buildWorkers` runs with bounded concurrency (8); `memo` shares an in-flight
  build between overlapping requests.
- A pid whose process started after the status file's last update is not the
  runner: the worker is "orphaned". The hound (same OpenCode helper as the
  translator, free model) reads the evidence (status text, todo progress, last
  messages, commits on the worker branch since start) and returns done or
  error. The verdict is cached by the monitor in a git-ignored JSON keyed by
  project + track + status time, never written into the other project's kit
  files. Done shows green and hides like any finished card; error shows red.
  While no verdict exists the card shows as error-pending, not stale.

## Tasks

- [x] T1 Translation model default to longcat-2.5-preview-free (route: inline, 1 mechanical change across config/docs/tests)
- [x] T2 Bounded concurrency in buildWorkers + in-flight dedupe in memo, with tests (route: delegated builder, 1-2 non-trivial files)
- [x] T3 Orphaned-worker detection by process start time + hound verdict cache + UI states, with tests (route: delegated builder, 3+ non-trivial files)

## Checks

- `node --test monitor/test` (TDD: not configured for this repo; ordinary checks)
- Manual: `/api/state?project=flota` under 15 s; spec-draft card leaves "sin reporte reciente"; new commits get Spanish subjects.

## Progress

- Branch: `feat/monitor-reliability`
- T1 e162657: translator on longcat; translations.json written again 2026-10-16 21:53 (603 cached commits).
- T2 8eab084 (OpenCode builder, reviewed): flota /api/state 11.6 s (was > 60 s).
- T3 64b8b08 (OpenCode builder, reviewed) + 93dcf8c fix: PowerShell exits 1 when a pid in the batch is gone, which emptied the start-time map; forced exit 0. Hound reason forced to Spanish.
- Verified live: spec-draft went error "proceso perdido · analizando" -> done in ~45 s with a Spanish reason; verdict cached in monitor/verdicts.json.
- Tests: node --test monitor/test/*.test.mjs -> 334 tests, 333 pass, 0 fail, 1 skipped.
- Open: server crashes with 0xC0000409 several times a day (seen again 21:50:19, 24 s after start); not investigated.
- d970c57: tracks with no status file show as queued ("en cola"), not error; hide countdown starts when a finished card is first seen and restarts on state change (cards with a status time keep using it).
- 4352276: /api/state answers a per-project cached snapshot at once, refreshes it in the background after 2 s, overlapping requests share one build, config edits bypass the cache. Live: flota first request 9.2 s, next ones 0.6-0.7 s. Tests 339/338 pass/0 fail.
- Next: merge feat/monitor-reliability into main and push (user decision).
