import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");

test("the page never scrolls at document level", () => {
  assert.match(html, /html,\s*body\s*\{[^}]*overflow:\s*hidden/);
  assert.match(html, /\.app\s*\{[^}]*height:\s*100vh/);
});

test("worker cards auto-fit and their lines ellipsize with a tooltip", () => {
  assert.match(html, /\.workers\s*\{[^}]*repeat\(auto-fit,\s*minmax\(/);
  assert.match(html, /\.workers\s*\{[^}]*overflow:\s*hidden/);
  assert.match(html, /\.event\s*>\s*span\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(html, /detail\.title\s*=/);
});

test("the git graph fills the free space (min 32vh) with its own scroll and honors reduced motion", () => {
  assert.match(html, /\.git\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(html, /\.git\s*\{[^}]*min-height:\s*140px/);
  assert.match(html, /\.workers\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(html, /\.git-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /\.commit\.is-new\s*\{[^}]*animation:/);
});

test("the page uses the structured graph and the activity line budget", () => {
  assert.match(html, /next\.git\.commits|git\.commits/);
  assert.match(html, /next\.activityLines/);
  assert.match(html, /events\.slice\(-activityLines\)/);
});

test("the git lanes and nodes use the branch colours computed by the server", () => {
  assert.match(html, /commit\.laneColors/);
  assert.match(html, /laneColor\(commit, lane\)/);
  assert.match(html, /laneColor\(commit, link\.lane\)/);
  assert.match(html, /laneColor\(commit, commit\.lane\)/);
  assert.doesNotMatch(html, /var LANE_COLORS/);
});

test("the title and the agents heading show the new copy", () => {
  assert.match(html, /<h1>Monitor<\/h1>/);
  assert.match(html, /<title>Monitor<\/title>/);
  assert.match(html, /id="workers-title">Agentes/);
  assert.match(html, /" activos \/ " \+ list\.length \+ " en total"/);
});

test("the agents heading hides finished cards behind an accessible toggle and stays clean at zero", () => {
  assert.match(html, /renderWorkers\(next\.workers, next\.hiddenWorkers, next\.hiddenFinished, next\.activityLines, next\.activityLinesTotal\)/);
  assert.match(html, /<button type="button" class="hidden-toggle" id="hidden-toggle" aria-pressed="false"/);
  assert.match(html, /\.hidden-toggle\s*\{[^}]*cursor:\s*pointer/);
  assert.match(html, /toggle\.hidden = hidden === 0/);
  assert.match(html, /toggle\.setAttribute\("aria-pressed"/);
  assert.match(html, /hidden === 1 \? "1 terminada oculta" : hidden \+ " terminadas ocultas"/);
  assert.match(html, /hidden === 1 \? "ocultar 1 terminada" : "ocultar " \+ hidden \+ " terminadas"/);
  assert.match(html, /meta\.length \? "· " \+ meta\.join\(" · "\) : ""/);
});

test("the hidden-cards choice survives the refresh and the cards render after the visible ones", () => {
  assert.match(html, /showHidden \? list\.concat\(hiddenList\) : list/);
  assert.match(html, /showHidden && hiddenList\.indexOf\(worker\) !== -1/);
  assert.match(html, /\.worker\.worker-hidden\s*\{[^}]*opacity:/);
  assert.match(html, /badge badge-hidden", "oculta"/);
  assert.match(html, /try \{[\s\S]{0,120}localStorage\.getItem\(HIDDEN_STORAGE_KEY[\s\S]{0,120}\} catch/);
  assert.match(html, /try \{[\s\S]{0,200}localStorage\.setItem\(HIDDEN_STORAGE_KEY[\s\S]{0,200}\} catch/);
  assert.match(html, /Number\(showHidden \? activityLinesTotal : activityLines\)/);
});

test("the top bar names the orchestrator and shows its model and effort", () => {
  assert.match(html, /id="orch-engine">ORQUESTADOR:</);
  assert.match(html, /id="orch-model"/);
  assert.match(html, /orchestrator\.text/);
});

test("the header project selector travels in the URL, localStorage and every poll", () => {
  assert.match(html, /<select id="project-select"/);
  assert.match(html, /\.project-picker select\s*\{[^}]*max-width:\s*220px/);
  assert.match(html, /urlProject\(\) \|\| storedProject\(\)/);
  assert.match(html, /known \? remembered : defaultProjectId/);
  assert.match(html, /try \{[\s\S]{0,120}localStorage\.getItem\(PROJECT_STORAGE_KEY[\s\S]{0,120}\} catch/);
  assert.match(html, /try \{[\s\S]{0,200}localStorage\.setItem\(PROJECT_STORAGE_KEY[\s\S]{0,200}\} catch/);
  assert.match(html, /window\.history\.replaceState/);
  assert.match(html, /"\/api\/state" \+ query/);
  assert.match(html, /response\.status === 404 && projectId/);
  assert.match(html, /fetch\("\/api\/projects"/);
});

test("every usage meter keeps its own row with bars, reset and age", () => {
  assert.match(html, /\.usage\s*\{[^}]*display:\s*grid/);
  assert.match(html, /\.usage-row\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(html, /\.usage-label\s*\{[^}]*min-width:\s*96px/);
  assert.match(html, /usageLevelOf\(value\)/);
  assert.match(html, /value >= 90 \? "crit" : value >= 70 \? "warn" : "ok"/);
  assert.match(html, /el\("span", "usage-reset", reset\)/);
  assert.match(html, /el\("span", "usage-age"/);
});

test("worker cards colour the chip and the title by state and animate the Tron border", () => {
  assert.match(html, /worker\.stateKind \|\| worker\.state/);
  assert.match(html, /badge badge-" \+ kind/);
  assert.match(html, /--work:\s*#ffc233/);
  assert.match(html, /--wait:\s*#57d7ff/);
  assert.match(html, /\.badge-done\s*\{[^}]*color:\s*var\(--live\)/);
  assert.match(html, /\.worker\.state-done::before/);
  assert.match(html, /conic-gradient\(from var\(--tron-angle\)/);
  assert.match(html, /@keyframes tron-border/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*state-done::before[\s\S]*display:\s*none/);
});

test("the display font is bundled locally and allowed by the CSP", () => {
  assert.match(html, /font-src 'self'/);
  assert.match(html, /@font-face[\s\S]*family:\s*"Share Tech Mono"/);
  assert.match(html, /url\("\/fonts\/share-tech-mono\.woff2"\)/);
  assert.match(html, /font-family:\s*var\(--font-display\)/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("git subjects and worker commits prefer the Spanish translation", () => {
  assert.match(html, /commit\.subjectEs \|\| english/);
  assert.match(html, /subject\.title = english/);
  assert.match(html, /worker\.lastCommit\.subjectEs \|\| original/);
  assert.match(html, /commit\.title = worker\.lastCommit\.sha \+ " " \+ original/);
});

test("each worker card repeats its branch colour next to the model and effort", () => {
  assert.match(html, /\.worker-meta \.branch-swatch\s*\{[^}]*width:\s*48px/);
  assert.match(html, /\.worker-meta \.branch-swatch\s*\{[^}]*height:\s*3px/);
  assert.match(html, /\.worker-meta \.branch-swatch\s*\{[^}]*border-radius:\s*2px/);
  assert.match(html, /\.worker-meta \.branch-swatch\s*\{[^}]*background:\s*var\(--dim\)/);
  assert.match(html, /el\("span", "branch-swatch"\)/);
  assert.match(html, /swatch\.style\.background = worker\.branchColor/);
  assert.match(html, /meta\.appendChild\(swatch\)/);
});

test("working builders show their Spanish summary under the title", () => {
  assert.match(html, /\.worker-summary\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(html, /el\("div", "worker-summary", worker\.summaryEs\)/);
  assert.match(html, /summary\.title = worker\.summaryEs/);
});

test("the card shows the todo progress as a segmented bar with pace and idle chips", () => {
  // A fixed-height row keeps the card from jumping when it first appears, and
  // every colour comes from a theme token.
  assert.match(html, /\.worker-progress\s*\{[^}]*height:\s*14px/);
  assert.match(html, /\.progress-bar\s*\{[^}]*height:\s*7px/);
  assert.match(html, /\.progress-seg\s*\{[^}]*border:\s*1px solid rgba\(var\(--dim-rgb\), 0\.55\)/);
  assert.match(html, /\.progress-seg\.done\s*\{[^}]*background:\s*var\(--live\)/);
  assert.match(html, /\.progress-seg\.doing\s*\{[^}]*background:\s*var\(--work\)/);
  assert.match(html, /\.worker\.state-working \.progress-seg\.doing\s*\{[^}]*animation:\s*progress-pulse/);
  assert.match(html, /@keyframes progress-pulse/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*\.worker\.state-working \.progress-seg\.doing\s*\{[^}]*animation:\s*none/);
  assert.match(html, /\.pace-adelantado\s*\{[^}]*color:\s*var\(--wait\)/);
  assert.match(html, /\.pace-en-hora\s*\{[^}]*color:\s*var\(--live\)/);
  assert.match(html, /\.pace-demorado\s*\{[^}]*color:\s*var\(--warn\)/);
  assert.match(html, /\.progress-idle\s*\{[^}]*color:\s*var\(--warn\)/);
  // At most 30 segments; above that one segment per equal slice of the list.
  assert.match(html, /Math\.min\(progress\.items\.length, 30\)/);
  assert.match(html, /"progress-seg " \+ progressSliceStatus\(progress\.items, i, slices\)/);
  assert.match(html, /text\.textContent \+= " · " \+ progress\.current/);
  // A list carried from a previous attempt of the same track says so in the
  // same dim text, still through textContent only.
  assert.match(html, /if \(progress\.carried\) text\.textContent \+= " \(intento anterior\)"/);
  assert.match(html, /"chip pace-" \+ paceSlug\(worker\.pace\), worker\.pace/);
  assert.match(html, /"progress-idle", worker\.idleText/);
  assert.match(html, /var progress = progressRow\(worker\)/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("the git tree fills the free slots of the last row, else sits full-width below", () => {
  assert.doesNotMatch(html, /gitCardMode|workers\.insertBefore\(git/);
  assert.match(html, /grid-column:\s*span var\(--git-span, 1\)/);
  assert.match(html, /git\.style\.setProperty\("--git-span", String\(free\)\)/);
  assert.match(html, /workers\.appendChild\(git\)/);
  assert.match(html, /app\.appendChild\(git\)/);
  assert.match(html, /\.app\s*\{[^}]*overflow-y:\s*auto/);
});

test("every inline script block parses", () => {
  const blocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g));
  assert.ok(blocks.length >= 2, "the page keeps its logic in inline scripts");
  blocks.forEach((block) => {
    assert.doesNotThrow(() => new Function(block[1]));
  });
});

test("the live viewer loads as a module and its colours come from the theme tokens", () => {
  assert.match(html, /<script type="module" src="\/js\/live-view\.mjs"><\/script>/);
  assert.match(html, /script-src 'self' 'unsafe-inline'/);
  assert.match(html, /FleetLiveView\.attach\(card, worker, projectId\)/);
  assert.match(html, /\.live-tab\.status-running\s*\{[^}]*var\(--work\)/);
  assert.match(html, /\.live-tab\.status-done\s*\{[^}]*var\(--live\)/);
  assert.match(html, /\.live-tab\.status-error\s*\{[^}]*var\(--err\)/);
  assert.match(html, /\.live-pre\s*\{[^}]*background:\s*var\(--code-bg\)/);
  assert.match(html, /\.live-viewer\.collapsed \.live-body\s*\{[^}]*display:\s*none/);
});

function styleCss() {
  const block = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(block, "the page keeps its CSS in one style block");
  return block[1];
}

function themeTokenBlocks() {
  const css = styleCss().replace(/\/\*[\s\S]*?\*\//g, "");
  return Array.from(css.matchAll(/:root[^{]*\{[^}]*\}/g)).map((match) => match[0]);
}

test("every colour outside the theme token blocks comes from var()", () => {
  // Everything that paints a colour must read a token; `transparent` and
  // `currentColor` carry no value of their own, and the mask gradient is
  // tokenized too (`--mask-fill`), so the CSS stays theme-agnostic.
  const css = styleCss().replace(/:root[^{]*\{[^}]*\}/g, "");
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], "hex colours outside the token blocks: " + hex.join(", "));
  const literalRgb = css.match(/\brgba?\(\s*(?!var\()/g) || [];
  assert.deepEqual(literalRgb, [], "literal rgb()/rgba() outside the token blocks");
  assert.match(css, /transparent/);
  assert.match(css, /currentColor/);
  assert.doesNotMatch(css, /linear-gradient\(#/);
});

test("the Matrix theme block defines every token group the page promises", () => {
  const matrix = themeTokenBlocks().find((block) => /\[data-theme="matrix"\]/.test(block));
  assert.ok(matrix, "the Matrix theme block exists");
  for (const name of ["--bg", "--panel", "--live", "--text", "--dim", "--warn", "--err", "--work", "--wait", "--stale"]) {
    assert.match(matrix, new RegExp(name + ":"), name + " stays in the state palette");
  }
  for (let index = 0; index < 8; index += 1) {
    assert.match(matrix, new RegExp("--branch-" + index + ":"), "branch slot " + index);
  }
  assert.match(matrix, /--branch-neutral:/);
  for (const name of ["--code-bg", "--code-text", "--code-keyword", "--code-string", "--code-comment", "--code-number", "--code-function", "--code-added-bg", "--code-removed-bg"]) {
    assert.match(matrix, new RegExp(name + ":"), name + " stays in the code palette");
  }
  for (let index = 0; index < 16; index += 1) {
    assert.match(matrix, new RegExp("--ansi-" + index + ":"), "ansi colour " + index);
  }
});

test("the base :root fallback mirrors the Matrix values so nothing renders unstyled", () => {
  const blocks = themeTokenBlocks();
  const base = blocks.find((block) => /^:root\s*\{/.test(block));
  const matrix = blocks.find((block) => /\[data-theme="matrix"\]/.test(block));
  assert.ok(base, "the fallback block exists");
  assert.ok(matrix, "the Matrix block exists");
  const values = (block) => Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g)).map((match) => match[1] + ":" + match[2].trim());
  assert.deepEqual(values(base), values(matrix));
});

test("the header offers the theme picker and the background switch, remembered in storage", () => {
  assert.match(html, /var THEMES = \[\{ id: "matrix", name: "Matrix", background: "matrix-rain" \}\]/);
  assert.match(html, /<select id="theme-select"/);
  assert.match(html, /for="theme-select"/);
  assert.match(html, /<button type="button" class="bg-toggle" id="bg-toggle" aria-pressed="true">FONDO ON<\/button>/);
  // The theme is applied before the stylesheet renders, so the first paint is
  // already themed.
  assert.match(html, /<script>[\s\S]{0,400}localStorage\.getItem\("fleet-monitor\.theme"\)[\s\S]{0,400}<\/script>\s*<style>/);
  assert.match(html, /storedItem\(THEME_STORAGE_KEY\)/);
  assert.match(html, /rememberItem\(THEME_STORAGE_KEY, currentTheme\)/);
  assert.match(html, /try \{[\s\S]{0,120}localStorage\.getItem\(key[\s\S]{0,120}\} catch/);
  assert.match(html, /try \{[\s\S]{0,200}localStorage\.setItem\(key[\s\S]{0,200}\} catch/);
  assert.match(html, /document\.documentElement\.setAttribute\("data-theme"/);
  assert.match(html, /backgroundEnabled \? "FONDO ON" : "FONDO OFF"/);
});

test("the animated background is a registry module that follows the theme rules", () => {
  assert.match(html, /var BACKGROUNDS = \{/);
  assert.match(html, /"matrix-rain": \(function \(\) \{/);
  assert.match(html, /return \{ start: start, stop: stop, resize: resize \}/);
  assert.match(html, /now - last >= 50/);
  assert.match(html, /if \(!running\) return/);
  assert.match(html, /document\.hidden/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /palette\.rainGlyph/);
  assert.match(html, /module\.start\(document\.getElementById\("rain"\), tokens\(\)\)/);
  assert.match(html, /#rain\s*\{[^}]*pointer-events:\s*none/);
});

test("the page paints branch colours through the theme variables when it can", () => {
  assert.match(html, /commit\.laneColorIndexes/);
  assert.match(html, /"var\(--branch-" \+ index/);
  assert.match(html, /"var\(--branch-" \+ worker\.branchColorIndex/);
  assert.match(html, /"var\(--branch-neutral\)"/);
  assert.match(html, /swatch\.style\.background = worker\.branchColor/);
  assert.match(html, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\(name\)/);
  assert.match(html, /ctx\.strokeStyle = color/);
});

test("the git rails are a canvas of binary glyphs drawn every frame, with main emphasized", () => {
  assert.match(html, /<canvas id="git-lines"/);
  assert.match(html, /window\.requestAnimationFrame\(gitFrame\)/);
  assert.match(html, /function laneIsMain\(commit, lane\)/);
  assert.match(html, /seg\.main \? "bold 11px" : "9px"/);
  assert.match(html, /ctx\.lineWidth = seg\.main \? 6 : 4/);
  assert.match(html, /var WAVE_SPEED = 0\.9/);
  assert.match(html, /var MAIN_COLOR = "var\(--branch-0\)"/);
});

test("meters and PC load stay hidden unless the config shows them", () => {
  assert.match(html, /\.usage\[hidden\]/);
  assert.match(html, /getElementById\("usage"\)\.hidden = ui\.showUsage !== true/);
  assert.match(html, /getElementById\("pc"\)\.hidden = ui\.showPc !== true/);
});

test("Claude cards share miniature groups of three once there are more than two", () => {
  assert.match(html, /var MINI_GROUP_FROM = 2/);
  assert.match(html, /batches\[worker\.miniGroup\]/);
  assert.match(html, /\.worker-group \.mini\s*\{[^}]*zoom:\s*0\.5/);
});

test("git rows have a fixed time column, day separators, type badges and card animations", () => {
  assert.match(html, /function dayLabel\(iso\)/);
  assert.match(html, /function daySeparator\(label\)/);
  assert.match(html, /function drawGap\(rails, previous, row\)/);
  assert.match(html, /el\("span", "ctype ctype-"/);
  assert.match(html, /\.commit, \.day-row\s*\{[^}]*grid-template-columns:\s*var\(--time-w\)/);
  assert.match(html, /@keyframes card-in/);
  assert.match(html, /@keyframes card-out/);
  assert.match(html, /classList\.add\("is-entering"\)/);
  assert.match(html, /classList\.add\("is-leaving"\)/);
});

test("a miniature group has its own frame coloured by state and animates as one", () => {
  assert.match(html, /\.worker-group\s*\{[^}]*border:\s*1px solid var\(--border\)/);
  assert.match(html, /\.worker-group\.group-working/);
  assert.match(html, /group\.setAttribute\("data-key", "group:" \+ key\)/);
  assert.match(html, /\.worker-group\.is-leaving/);
});

test("every render helper the page calls is defined", () => {
  const defined = new Set(Array.from(html.matchAll(/function (\w+)\(/g)).map((match) => match[1]));
  const called = Array.from(html.matchAll(/^\s{4}(render\w+|apply\w+|hide\w+|fill\w+)\(/gm)).map((match) => match[1]);
  assert.ok(called.length > 3, "the render function calls its panel helpers");
  called.forEach((name) => assert.ok(defined.has(name), name + " must be defined"));
});

test("an open tab reloads itself when the server reports a new page build", () => {
  assert.match(html, /next\.buildId/);
  assert.match(html, /window\.location\.reload\(\)/);
});

test("the git graph stays visible in card mode and commit nodes open a hover bubble", () => {
  assert.doesNotMatch(html, /\.workers > \.git #git-lines\s*\{[^}]*display:\s*none/);
  assert.match(html, /canvas\.addEventListener\("mousemove", onGitHover\)/);
  assert.match(html, /canvas\.addEventListener\("mouseleave", hideGitTip\)/);
  assert.match(html, /\.git-tip\.is-open/);
  assert.match(html, /function fillGitTip\(tip, commit\)/);
});
