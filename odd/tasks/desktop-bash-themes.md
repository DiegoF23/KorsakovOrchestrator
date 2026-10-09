# Desktop and Bash themes

## Objective
Add Claude Desktop and Terminal Bash as complete, token-driven monitor themes without changing Matrix defaults or persisted selection behavior.

## Scope and constraints
- Authorized root: this worktree only; app changes in `monitor/`.
- Source scope: `monitor/index.html` and `monitor/test/layout.test.mjs`.
- Keep code, CSS, comments, and this document in English; preserve existing Spanish UI labels.
- Preserve state meanings, define every token, disable decorative glow/background for both themes, and respect reduced motion.
- Normal UI text must meet 4.5:1 contrast; retain the exact requested Tango ANSI palette (terminal escape colors are externally selected).
- Main lane uses the green/accent in `--branch-0`; all other branch slots remain distinguishable.
- No push, PR, other worktree changes, or main-checkout changes.

## Routing and checks
- Route: delegated direct. Mapping/preparation and two non-trivial source files require delegation.
- TDD: off, matching existing ODD documents; no newer project/session configuration found.
- Runner: from `monitor/`, `node --test test/*.test.mjs`.
- Forecast: approximately 400 authored changed lines; a planning heuristic, not a hard cap. Delivery strategy: ask-on-risk; no PR requested.
- Review mode: unknown; native status failed with access denied while resolving repository identity.
- Baseline: targeted layout tests 34/34; full suite encountered a sandbox temp-directory permission failure.

## Tasks
- [ ] T1: Implement both theme manifests, token-driven typography/corners/effects, registration, and sensible no-background toggle behavior; extend discipline and behavioral tests. Verify all tests and full-page color-literal discipline, then commit as one coherent work unit.

## Acceptance criteria
- Registry and pre-paint allowlist contain `matrix`, `claude-desktop`, and `bash`; Matrix remains default.
- All registered theme blocks have the complete token set; fallback exactly mirrors Matrix.
- Claude uses warm neutrals, terracotta accent, sans UI and mono code; Bash uses black, square lines, mono fonts and Tango ANSI colors.
- No literal hex/rgb color occurs outside root token blocks; no theme-specific colors/fonts/effects leak into components.
- Switching away from Matrix stops rain; unavailable background toggle is disabled/hidden without losing the stored preference.
- Checks report observed results only. Browser visual inspection, if unavailable, is explicitly disclosed.

## Evidence and next step
- Branch: `builder/themes`; initial boundary: `4001d0cb6a34a5c5665efed95c767c8586a3a4eb`.
- Implementation and independent revalidation complete; task closure awaits the requested commit.
- `node --test test/layout.test.mjs`: 40 passed, 0 failed (writer and parent spot check).
- `node --test test/*.test.mjs`: 272 passed, 0 failed, 1 skipped (writer and independent verifier), with process-local `HOME`/`USERPROFILE` pointing to `monitor/.verifier-home`, restored afterward.
- Default-home full suite: one existing `EPERM` failure creating a home-directory fixture in `state.test.mjs`; changing `TMP`/`TEMP` alone does not fix this explicit home path.
- Skipped check: disguised-file symlink test in `test/files.test.mjs` because file links cannot be created here.
- Whole-HTML color discipline, complete registered-theme token sets, fallback/Matrix parity, exact Tango ANSI palette, foreground/filled-chip/composited-code contrast, real theme-toggle lifecycle, and immediate Git color-cache invalidation pass.
- `git diff --check`: clean. Native risk assessment unavailable/high due access denied resolving repository identity; independent functional verification completed instead. No fabricated native approval.
- Browser visual inspection unavailable. Optional title cursor omitted because the initial theme template has no token-driven title cursor effect.
- Source diff: 654 additions, 110 deletions (764 authored lines), larger than forecast because existing fonts, radii, CSS/keyframe effects, and canvas shadows needed token routing for genuinely glow-free themes. No PR planned; the user explicitly treats size as a planning heuristic, not a hard cap.
- Test fixture directories remain untracked; cleanup commands were denied. Only the two source files and this document are intended for staging.
- Commit blocked: `git add` failed with permission denied creating the linked worktree Git metadata `index.lock`, outside the writable worktree. No commit identity exists; no push or PR occurred.
- Rollback boundary: both theme blocks/registration and associated generic styling/test changes; unrelated monitor behavior remains untouched.
- Next: stage only `monitor/index.html`, `monitor/test/layout.test.mjs`, and this document in a session with writable worktree Git metadata; commit as `feat(monitor): add Claude Desktop and Terminal Bash themes`, then record the commit identity and close T1. Do not stage the untracked test fixtures.
