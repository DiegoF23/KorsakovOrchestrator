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

function loadGitCardMode() {
  const block = html.match(/<script id="git-layout-logic">([\s\S]*?)<\/script>/);
  assert.ok(block, "the pure git layout logic lives in its own script block");
  return new Function(block[1] + "\nreturn gitCardMode;")();
}

test("the card-mode decision thresholds at one worker card or 22vh", () => {
  const gitCardMode = loadGitCardMode();
  assert.equal(gitCardMode(300, 1000, "panel"), "panel");
  assert.equal(gitCardMode(219, 1000, "panel"), "card");
  assert.equal(gitCardMode(139, 500, "panel"), "card");
  assert.equal(gitCardMode(140, 500, "panel"), "panel");
});

test("the card-mode decision has hysteresis and no flicker band", () => {
  const gitCardMode = loadGitCardMode();
  assert.equal(gitCardMode(220, 1000, "panel"), "panel");
  assert.equal(gitCardMode(220, 1000, "card"), "card");
  assert.equal(gitCardMode(243, 1000, "card"), "card");
  assert.equal(gitCardMode(244, 1000, "card"), "panel");
  for (let available = 0; available <= 600; available += 1) {
    const fromPanel = gitCardMode(available, 1000, "panel");
    assert.equal(gitCardMode(available, 1000, fromPanel), fromPanel, "stable from panel at " + available);
    const fromCard = gitCardMode(available, 1000, "card");
    assert.equal(gitCardMode(available, 1000, fromCard), fromCard, "stable from card at " + available);
  }
});

test("the git tree becomes the first worker card when space gets tight", () => {
  assert.match(html, /<script id="git-layout-logic">/);
  assert.match(html, /function gitCardMode\(available, viewportHeight, previous\)/);
  assert.match(html, /Math\.max\(GIT_PANEL_MIN_PX, viewportHeight \* GIT_CARD_MIN_VH\)/);
  assert.match(html, /\.workers > \.git\s*\{[^}]*contain:\s*size/);
  assert.match(html, /\.workers > \.git\s*\{[^}]*border:\s*1px solid var\(--border\)/);
  assert.match(html, /\.workers > \.git #git-lines\s*\{[^}]*display:\s*none/);
  assert.match(html, /\.workers > \.git \.commit \.chip\s*\{[^}]*display:\s*none/);
  assert.match(html, /\.git\.is-measuring\s*\{[^}]*position:\s*absolute/);
  assert.match(html, /gitCardMode\(measurePanelSpace\(\), window\.innerHeight, gitMode\)/);
  assert.match(html, /git\.classList\.add\("is-measuring"\)/);
  assert.match(html, /workers\.insertBefore\(git, workers\.firstChild\)/);
  assert.match(html, /app\.appendChild\(git\)/);
  assert.match(html, /applyGitLayout\(\)/);
  assert.match(html, /child !== gitCard/);
});

test("every inline script block parses", () => {
  const blocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g));
  assert.ok(blocks.length >= 2, "the page keeps its logic in inline scripts");
  blocks.forEach((block) => {
    assert.doesNotThrow(() => new Function(block[1]));
  });
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
  assert.match(html, /line\.style\.setProperty\("stroke", color\)/);
  assert.match(html, /node\.style\.setProperty\("fill"/);
});
