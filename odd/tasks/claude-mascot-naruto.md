# Claude Mascot and Naruto Themes

## Objective
Add the Claude mascot animated background and Naruto Dusk theme to the monitor while preserving existing themes, token parity, background lifecycle behavior, and theme-slot boundaries.

## Scope and constraints
- Authorized workspace: this worktree only. Do not inspect or modify another checkout.
- Authorized source files: `monitor/index.html`, `monitor/public/js/bg-claude-mascot.mjs`, `monitor/public/js/bg-naruto-dusk.mjs`, `monitor/test/layout.test.mjs`, and two new theme-specific test files under `monitor/test/`.
- `monitor/index.html` changes must stay within the explicitly authorized integration points: add the Claude registry background value, Claude rain opacity, Naruto CSS token block, Naruto registry/background-file entries, Claude `BACKGROUND_FILES` entry, and Naruto prepaint ID. Add required scene tokens to every existing theme block for parity. Preserve all separators and other themes' markers; do not reformat unrelated code.
- `monitor/test/layout.test.mjs` may change only obsolete Claude-background expectations (module is no longer null and opacity is no longer zero) and the theme-ID lists. Keep every other assertion unchanged. Existing lifecycle harness with a generic fake Claude module may remain generic.
- Keep artifacts in English and preserve existing Spanish UI labels. No installs, network access, remote operations, push, PR, staging, or commits; the user explicitly deferred commits.
- TDD: off, following `odd/tasks/desktop-bash-themes.md` (no newer project/session configuration supplied).
- Verification runner: from `monitor/`, run `node --test test/*.test.mjs` with `HOME` and `USERPROFILE` set to `<worktree>/.tmp-home` for the process.
- Route: delegated direct. Reading across the requirements, integration, layout tests, and prior ODD document required mapping; implementation spans multiple non-trivial files.
- Review mode: unknown; native mode lookup failed while resolving repository identity (access denied). Do not treat this as approval; independent verification is required.
- Forecast: approximately 500–700 authored changed lines, based on two theme integrations, full token parity, two modules, and focused tests. Advisory planning estimate only; no artificial size limit or code-golfing.
- Delivery: no PR planned. Commits are explicitly deferred by the user; record this constraint and do not stage or commit.

## Tasks
- [x] T1 — Claude mascot module and integration: implement `bg-claude-mascot.mjs`, wire it through Claude's background registry/file slots and scene tokens in all existing theme blocks, update only the authorized obsolete layout expectations, and add focused Claude module tests. Reopened for the previously missing explicit idle poses, rolled pose, READ unroll, and idle error transient; all received focused runtime coverage.
- [x] T2 — Naruto Dusk theme and background: add the Naruto token block and prepaint/registry/background-file wiring, implement `bg-naruto-dusk.mjs`, and add focused Naruto theme/module tests. Preserve every existing theme marker and separator. Reopened to ensure roof silhouettes retain blur; the silhouette filter behavior now has focused runtime coverage.
- [x] T3 — Full verification: run the specified full test suite with the process-local home paths, inspect the permitted diff for scope/marker integrity, record exact results and any unavailable checks, and leave corrective files unstaged and uncommitted.

## Acceptance criteria
- Claude and Naruto are valid prepaint/selector theme IDs; Matrix remains the default and existing themes retain their behavior.
- Claude's module is registered as a file-loaded background, receives the agents feed through the established lifecycle, and its theme has nonzero rain opacity.
- Naruto has a complete token block matching the existing theme token set, a registry entry, a file-loaded background entry, and a prepaint allowlist entry.
- Scene-specific token names exist in all existing theme blocks so scene modules consume computed tokens rather than hard-coded theme styling.
- Both modules follow the established `start(canvas, tokens)`, `stop()`, `resize()`, and optional `update(feed)` lifecycle, including reduced-motion and hidden-tab behavior as applicable to the existing background contract.
- Changes to `layout.test.mjs` remain limited to the explicitly authorized expectations and ID-list extensions; all other assertions remain untouched.
- Focused theme tests and the full suite pass, or failures/skips are reported honestly with exact command/results.
- No unrelated source formatting, stage, commit, push, PR, or remote operation occurs.

## Progress and next step
- T0 (this document): created before source changes.
- T1/T2 implementation: both standalone modules are wired through existing file-loaded background hooks; shared `--scene-*` tokens are present across the root, Matrix, Claude, Bash, and Naruto blocks. Naruto includes its own complete theme manifest and prepaint allowlist entry. Existing theme markers, separators, and unrelated assertions are retained.
- Correction state: independent verification found missing explicit NAP/Z/HOP/ROLL/LOOK poses, visibly expanding READ paper, finite idle error cue, and blur retained on Naruto roof silhouettes. These bounded fixes are complete and independently revalidated. Corrective edits touch only the two modules and their focused tests; `index.html` and `layout.test.mjs` remain unchanged.
- Git state when correction began: the worktree was clean at `1ae6b67833ae1b864d4ffc48aa4a1e6fa1f1944c` (`wip(monitor): claude mascot and naruto (in progress)`, commit time `2026-10-08T23:45:58-03:00`). This writer did not execute any stage or commit command and does not attribute creation of that commit. The corrective edits are uncommitted; no further stage/commit/push/PR/remote action is authorized.
- Corrective focused check: both module `node --check` commands passed; `node --test test/theme-claude-desktop.test.mjs test/theme-naruto.test.mjs` — 15 passed, 0 failed, 0 skipped. Runtime assertions exercise distinct hop/roll transforms, pupil movement, closed eyes/Z rectangles, paper growth, idle error expiry without retriggering and resumption of CMD work, and blur state for every hill/roof silhouette.
- Final full check after correction: `node --test test/*.test.mjs` — 291 tests, 290 passed, 0 failed, 1 skipped. The skip remains the existing disguised-file link test, which cannot create file links here. Both `node --check` commands passed again.
- Final diff check: `git diff --check` passed after line-ending normalization. Corrective diff is limited to the Claude/Naruto modules, their focused tests, and this document; no changes to `index.html` or `layout.test.mjs` were made during correction.
- Focused check: from `monitor/`, both `node --check` commands passed; `node --test test/theme-claude-desktop.test.mjs test/theme-naruto.test.mjs test/layout.test.mjs` — 54 passed, 0 failed, 0 skipped. An initial contrast-helper failure exposed that it cannot parse CSS-variable-based RGBA overlays; Naruto's added/removed code backgrounds now use explicit RGBA values within theme tokens, and the rerun passed.
- T3 full verification: from `monitor/`, both `node --check public/js/bg-claude-mascot.mjs` and `node --check public/js/bg-naruto-dusk.mjs` passed; `node --test test/*.test.mjs` — 288 tests, 287 passed, 0 failed, 1 skipped. The skip is the existing disguised-file link test, which cannot create file links in this environment.
- Structural checks: `git diff --check` passed. The layout suite passed full token-keyset parity, exact root/Matrix fallback parity, 4.5:1 text contrast (including Naruto), and no literal hex/rgb colors outside theme token blocks. Registry, prepaint IDs, module slots, and preserved marker assertions passed. Only the intended obsolete Claude expectations and theme ID/style lists changed in `layout.test.mjs`.
- Independent revalidation: 291 tests total, 290 passed, 0 failed, 1 existing file-link skip; both module syntax checks and current `git diff --check` passed. All previously identified requirements gaps are fixed; no new gap was found. Parent spot check: both theme test files, 15 passed. Browser visual inspection was not performed. Native assessment was unavailable/high due access denied resolving the repository root; no native approval is claimed.
- Actual authored diff: approximately 1,031 lines (tracked files: 230 changed lines in `monitor/index.html`, 13 in `layout.test.mjs`; new modules: 434 lines; focused tests: 306 lines; this task document: 48 lines). This exceeded the initial 500–700-line estimate because scene tokens were duplicated across every theme for parity and the two standalone modules and behavior tests were fully implemented; this is advisory only, with no artificial size limit.
- Delivery state: the initial implementation is in the observed WIP commit above; corrective changes remain unstaged and uncommitted. This writer performed no staging or commit, and no further commit, push, PR, or remote operation is authorized.
- Next: visually inspect both backgrounds in the monitor, including theme switches, background off, reduced motion, and text legibility. No further source change is pending; preserve the observed WIP commit and leave corrections unstaged/uncommitted.

## Key Learnings:
1. The monitor already supports file-loaded backgrounds via `BACKGROUND_FILES`, dynamic import, and `backgroundFeed`; scene integrations should use these existing extension points rather than changing lifecycle behavior.
2. The current layout test asserts Claude has no background and zero rain opacity; only those obsolete assertions and the theme ID lists are authorized for update.
3. The existing contrast helper supports concrete RGBA overlay token values but not nested `rgba(var(--token), alpha)`; use concrete RGBA values for overlays covered by that checker.
4. Animation requirements need behavior-level assertions, not just generic draw counts: time-stepped transforms, pixel states, and canvas filter state make intended behavior observable in tests.
