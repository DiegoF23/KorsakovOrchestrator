# Finish JARVIS HUD

## Objective and scope
Complete Task C's missing token-driven HUD module and regression tests in this worktree only. Preserve the previous agent's `monitor/index.html` changes unless a real defect is verified. No staging, commits, push, network, or external assets; the orchestrator owns commits. Artifacts are English.

## Routing and checks
- Route: delegated direct; reading prepares a write and two non-trivial files require one bounded writer.
- TDD: off, sourced from existing `odd/tasks/desktop-bash-themes.md`; no newer project/session configuration found.
- Runner: from `monitor/`, `node --test test/*.test.mjs`, with HOME and USERPROFILE set to this worktree's `.tmp-home`.
- Forecast: 250–350 authored additions; planning heuristic only. Delivery strategy: ask-on-risk; no PR or commit requested.
- Native review: unavailable (`gentle-ai` is not on PATH); no fabricated approval. Independent functional verification required.

## Tasks
- [x] T1: Implement `monitor/public/js/bg-jarvis-hud.mjs` and `monitor/test/theme-jarvis.test.mjs` as one behavior/test unit. Check the API, token wiring, activity/error response, 30fps cap, hidden pause, reduced-motion static rendering, and cleanup.
- [x] T2: Independently verify all monitor tests, module syntax, whole-HTML literal-color discipline, token parity, and embedded script syntax. Record actual pass/fail/skip counts and any visual limitation.

## Acceptance criteria
- Faint rings/ticks, radar sweep, hex-grid drift, scanning lines, numeric readouts, and corner brackets use computed `--scene-*` colors only.
- Working count increases ring speed and enables a traveling pulse; errors enable orange flicker.
- Hidden documents pause animation; reduced motion draws one static frame without scheduling animation; stop removes listeners and cancels frames/timers.
- Every Matrix token exists in JARVIS, registry wiring remains valid, and no hex/rgb literals occur outside root token blocks.
- Full suite passes with honest skipped/unavailable check reporting; no source outside authorized scope is changed.

## Evidence and next step
- Branch: `builder/theme-jarvis`; pre-existing edits: `monitor/index.html` and untracked `BRIEF-jarvis.md`.
- Read-only exploration found no concrete index defect; all scene tokens are present. Passed `tokens()` does not include scene colors, so the module reads computed CSS directly.
- Implementation and independent verification complete. Commit identity by this task: none; commits explicitly prohibited.
- Writer checks: focused tests 7 passed; full suite 283 total, 282 passed, 0 failed, 1 skipped (existing symlink capability test). Module syntax and whole-index token discipline passed. Parent syntax spot check and `git diff --check` passed.
- The first full run found the existing expected manifest/first-paint allowlist omitted JARVIS. Updated only those expected entries in `monitor/test/layout.test.mjs`, as allowed by the brief; the rerun passed. No index edits were necessary.
- Independent checking found reduced-motion start omitted the resize listener; corrected the module and its test so viewport changes redraw at time zero without RAF. Independent revalidation: focused 7 passed; full suite 283 total, 282 passed, 0 failed, 1 existing symlink skip; syntax passed.
- All root token sets match, CSS braces balance, inline scripts parse, registry commas are valid, and no hex/rgb literal exists outside root token blocks. Browser visual appearance was not verified. Native review unavailable; ordinary checks completed without native approval.
- During the task the existing index changes became tracked in external commit `907cf43`; no agent on this task staged or committed. The JARVIS index content remains present and unchanged by this task.
- Actual two new files: 527 lines, above initial forecast to include rendering and behavioral lifecycle coverage. No PR or commit is being planned; no delivery-size decision is needed here.
- Mirror: synchronized under `odd/jarvis-hud-finish/tasks`; updates are read back after each task.
- Next: orchestrator may commit the two new module/test files, the expected-ID test extension, and this recovery document. Preserve unrelated untracked `BRIEF-jarvis.md`; no push performed.
- Rollback boundary: remove only the two new HUD/test files and this tracking document; preserve earlier theme wiring and unrelated work.
