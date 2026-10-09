import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import background from "../public/js/bg-vscode-ghost.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const moduleSource = fs.readFileSync(path.join(here, "..", "public/js/bg-vscode-ghost.mjs"), "utf8");
const sceneKeys = [
  "--scene-editor", "--scene-panel", "--scene-border", "--scene-text", "--scene-dim",
  "--scene-keyword", "--scene-string", "--scene-function", "--scene-number",
  "--scene-type", "--scene-error", "--scene-cyan", "--scene-accent",
  "--scene-mono-font", "--scene-title-font", "--scene-transparent"
];
const globalNames = ["document", "innerWidth", "innerHeight", "devicePixelRatio", "performance", "addEventListener", "removeEventListener", "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "console"];
const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function tokenBlocks() {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  return Array.from(style.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/:root[^{}]*\{[^}]*\}/g), (match) => match[0]);
}

function harness({ hidden = false, reduced = false, width = 1200, height = 800, missingToken = null, failFirstClippedText = false } = {}) {
  const listeners = new Map();
  const scheduled = new Map();
  const calls = { clear: 0, fills: [], texts: [], snapshots: [], paths: [], errors: [], transform: 0, saveDepth: 0 };
  let currentSnapshot = null;
  let nextId = 1;
  let now = 1000;
  let inClip = false;
  let failedText = false;
  const contextState = [];
  const context = {
    globalAlpha: 1,
    save() { contextState.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, inClip }); calls.saveDepth += 1; },
    restore() { const restored = contextState.pop(); if (!restored) throw new Error("unbalanced canvas restore"); Object.assign(this, restored); inClip = restored.inClip; calls.saveDepth -= 1; },
    beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { calls.paths.push({ type: "stroke", alpha: this.globalAlpha, strokeStyle: this.strokeStyle }); },
    fill() { calls.paths.push({ type: "fill", alpha: this.globalAlpha, fillStyle: this.fillStyle }); },
    rect(...args) { calls.clipRect = args; }, clip() { inClip = true; },
    clearRect() { calls.clear += 1; currentSnapshot = { fills: [], texts: [] }; calls.snapshots.push(currentSnapshot); },
    fillRect(...args) { const record = { args, fillStyle: this.fillStyle, alpha: this.globalAlpha }; calls.fills.push(record); currentSnapshot?.fills.push(record); }, strokeRect(...args) { calls.paths.push({ type: "strokeRect", args, alpha: this.globalAlpha, strokeStyle: this.strokeStyle }); },
    roundRect(x, y, w, h) { assert.ok(w >= 0 && h >= 0, `roundRect dimensions must be non-negative: ${w}x${h}`); }, fillText(text, x, y) {
      if (failFirstClippedText && inClip && !failedText) { failedText = true; throw new Error("transient Canvas fillText failure"); }
      const record = { text: String(text), x, y, fillStyle: this.fillStyle, alpha: this.globalAlpha };
      calls.texts.push(record); currentSnapshot?.texts.push(record);
    },
    measureText(text) { return { width: String(text).length * 7 }; },
    setTransform() { calls.transform += 1; },
    createRadialGradient() { return { gradient: true, addColorStop() {} }; }
  };
  const target = {
    addEventListener(name, handler) {
      const set = listeners.get(name) || new Set(); set.add(handler); listeners.set(name, set);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    dispatch(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
    count(name) { return listeners.get(name)?.size || 0; }
  };
  const media = Object.assign(target, { matches: reduced });
  const sceneValues = {
    "--scene-editor": "#282c34", "--scene-panel": "#21252b", "--scene-border": "#333842",
    "--scene-text": "#abb2bf", "--scene-dim": "#5c6370", "--scene-keyword": "#c678dd",
    "--scene-string": "#98c379", "--scene-function": "#61afef", "--scene-number": "#d19a66",
    "--scene-type": "#e5c07b", "--scene-error": "#e06c75", "--scene-cyan": "#56b6c2",
    "--scene-accent": "#4d78cc", "--scene-mono-font": "'JetBrains Mono', Consolas, monospace",
    "--scene-title-font": "'Segoe UI', system-ui, sans-serif", "--scene-transparent": "transparent"
  };
  if (missingToken) delete sceneValues[missingToken];
  for (const key of sceneKeys) {
    if (key !== missingToken) assert.ok(sceneValues[key], `harness provides ${key}`);
  }
  Object.assign(globalThis, {
    document: Object.assign(target, { hidden }),
    innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    performance: { now() { return now; } },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    getComputedStyle() { return { getPropertyValue(key) { return key === "--rain-opacity" ? "0.12" : sceneValues[key] || ""; } }; },
    matchMedia() { return media; },
    requestAnimationFrame(callback) { const id = nextId++; scheduled.set(id, callback); return id; },
    cancelAnimationFrame(id) { scheduled.delete(id); },
    console: { error(...args) { calls.errors.push([args[0], String(args[1])]); } }
  });
  const canvas = { width: 0, height: 0, clientWidth: width, clientHeight: height, getContext() { return context; } };
  return {
    canvas, calls, target, media, scheduled,
    runFrame(time, callbackTimestamp = time) { const [id, callback] = scheduled.entries().next().value || []; if (callback) { scheduled.delete(id); now = time; callback(callbackTimestamp); } },
    values: sceneValues,
    codeLine(snapshot, y = 96) { return snapshot.texts.filter((entry) => entry.y === y && entry.x >= 160).map((entry) => entry.text).join(""); },
    caretCount(snapshot) { return snapshot.fills.filter((entry) => entry.args[2] === 2 && entry.args[3] === 19).length; }
  };
}

test("VSCode theme registers its ghost background and replaces only the reserved slots", () => {
  assert.match(html, /\{ id: "vscode", name: "VSCode", background: "vscode-ghost" \}/);
  assert.match(html, /"vscode-ghost": "\/js\/bg-vscode-ghost\.mjs"/);
  assert.match(html, /theme-slot:vscode-css/);
  assert.doesNotMatch(html, /\/\* theme-slot:vscode-css \*\//);
  assert.match(html, /\{ id: "vscode", name: "VSCode", background: "vscode-ghost" \},\s*\/\/ ----\s*\{ id: "jarvis"/);
  assert.match(html, /"vscode-ghost": "\/js\/bg-vscode-ghost\.mjs",\s*\/\/ ----\s*"jarvis-hud"/);
  const themeRegistry = html.match(/var THEMES = \[([\s\S]*?)\];/)?.[1] || "";
  const backgroundRegistry = html.match(/var BACKGROUND_FILES = \{([\s\S]*?)\};/)?.[1] || "";
  assert.match(themeRegistry, /theme-slot:naruto[\s\S]*?\{ id: "vscode"[\s\S]*?\{ id: "jarvis"/);
  assert.match(backgroundRegistry, /theme-slot:claude[\s\S]*?theme-slot:naruto[\s\S]*?vscode-ghost[\s\S]*?"jarvis-hud"/);
  assert.match(html, /\/\* theme-slot:naruto-css \*\/[\s\S]*?\/\* ---- \*\/[\s\S]*?\/\* theme-slot:vscode-css source slot: VSCode theme \*\/[\s\S]*?\/\* ---- \*\/[\s\S]*?\/\* theme-slot:jarvis-css/);
  assert.deepEqual(Object.keys(background).sort(), ["resize", "start", "stop", "update"]);
});

test("fallback, existing themes, and VSCode define the same complete scene token keyset", () => {
  const blocks = tokenBlocks();
  assert.equal(blocks.length, 7);
  for (const block of blocks) {
    for (const key of sceneKeys) assert.match(block, new RegExp(`${key}:`), key);
  }
  const vscode = blocks.find((block) => block.includes('[data-theme="vscode"]'));
  assert.ok(vscode);
  assert.match(vscode, /--code-bg:\s*var\(--scene-editor\)/);
  assert.match(vscode, /--branch-0:\s*#4d78cc/);
  assert.match(vscode, /--radius-1:\s*6px/);
  assert.match(vscode, /--rail-style:\s*ring/);
  assert.match(vscode, /--rain-opacity:\s*0\.85/);
  assert.match(vscode, /--font:\s*'JetBrains Mono'.*'Fira Code'.*'Cascadia Mono'.*Consolas/);
  assert.match(vscode, /--font-title:\s*'Segoe UI',\s*system-ui,\s*sans-serif/);
  assert.match(vscode, /--ansi-15:/);
  assert.match(vscode, /--ansi-4:\s*#61afef/);
  assert.match(vscode, /--git-shadow-main:\s*0/);
});

test("ghost module reads every scene color from computed root properties and has no literal colors", () => {
  assert.match(moduleSource, /getComputedStyle\(globalThis\.document\.documentElement\)/);
  assert.match(moduleSource, /for \(const key of SCENE_KEYS\) values\[key\] = style\.getPropertyValue\(key\)/);
  assert.match(moduleSource, /getPropertyValue\("--rain-opacity"\)/);
  for (const key of sceneKeys) assert.ok(moduleSource.includes(`"${key}"`), key);
  assert.doesNotMatch(moduleSource, /#[0-9a-f]{3,8}\b|\brgba?\(/i);
  assert.doesNotMatch(moduleSource, /["']transparent["']/);
  assert.doesNotMatch(moduleSource, /currentColor/);
  assert.match(moduleSource, /function readSceneTokens\(/);
  assert.match(moduleSource, /Error Lens/);
});

test("the ghost editor pauses while hidden and resumes without retaining hidden animation frames", () => {
  const env = harness({ hidden: true });
  background.start(env.canvas, {});
  assert.equal(env.scheduled.size, 0);
  env.target.hidden = false;
  env.target.dispatch("visibilitychange");
  assert.equal(env.scheduled.size, 1);
  env.target.hidden = true;
  env.target.dispatch("visibilitychange");
  assert.equal(env.scheduled.size, 0);
  background.stop();
});

test("reduced motion draws once; feeds and visibility do not poll-redraw, while visible resize refreshes geometry", () => {
  const env = harness({ reduced: true });
  background.start(env.canvas, {});
  const initialFrames = env.calls.clear;
  assert.equal(initialFrames, 1);
  assert.equal(env.codeLine(env.calls.snapshots[0]), "const projects = await loadProjects() { return projects; }");
  for (const bracketColor of ["--scene-accent", "--scene-cyan", "--scene-type"]) {
    const token = { "--scene-accent": "#4d78cc", "--scene-cyan": "#56b6c2", "--scene-type": "#e5c07b" }[bracketColor];
    assert.ok(env.calls.snapshots[0].texts.some((entry) => entry.fillStyle === token), `${bracketColor} bracket color is used`);
  }
  assert.equal(env.scheduled.size, 0);
  background.update({ working: 3, errors: 1 });
  assert.equal(env.calls.clear, initialFrames, "poll feeds do not redraw a reduced-motion frame");
  env.target.hidden = true;
  env.target.dispatch("visibilitychange");
  background.update({ working: 5, errors: 2 });
  globalThis.innerWidth = 900;
  env.target.dispatch("resize");
  background.resize();
  assert.equal(env.calls.clear, initialFrames, "hidden visibility, updates, and resize cause no draw");
  assert.equal(env.scheduled.size, 0);
  env.target.hidden = false;
  env.target.dispatch("visibilitychange");
  assert.equal(env.calls.clear, initialFrames + 1, "visibility draws the pending geometry refresh once");
  env.target.hidden = true;
  env.target.dispatch("visibilitychange");
  env.target.hidden = false;
  env.target.dispatch("visibilitychange");
  assert.equal(env.calls.clear, initialFrames + 1, "visibility cycles do not redraw an already-rendered static frame");
  background.resize();
  assert.equal(env.calls.clear, initialFrames + 2, "visible resize may refresh the static geometry");
  assert.equal(env.scheduled.size, 0);
  env.media.matches = false;
  env.media.dispatch("change", { matches: false });
  assert.equal(env.scheduled.size, 1);
  background.stop();
  assert.equal(env.scheduled.size, 0);
});

test("reduced motion started hidden waits for visibility and skips hidden resize/feed draws", () => {
  const env = harness({ hidden: true, reduced: true });
  background.start(env.canvas, {});
  assert.equal(env.calls.clear, 0);
  assert.equal(env.scheduled.size, 0);
  background.update({ working: 2, errors: 1 });
  globalThis.innerWidth = 320;
  globalThis.innerHeight = 568;
  env.target.dispatch("resize");
  assert.equal(env.calls.clear, 0);
  env.target.hidden = false;
  env.target.dispatch("visibilitychange");
  assert.equal(env.calls.clear, 1);
  assert.equal(env.scheduled.size, 0);
  background.stop();
});

test("tiny viewports skip unsafe geometry and a missing scene palette fails closed", () => {
  const tiny = harness({ width: 160, height: 90 });
  background.start(tiny.canvas, {});
  tiny.runFrame(1100);
  assert.equal(tiny.calls.fills.length, 0, "a too-small viewport does not draw negative panel geometry");
  background.stop();

  const missing = harness({ missingToken: "--scene-editor" });
  background.start(missing.canvas, {});
  assert.equal(missing.calls.clear, 0);
  assert.equal(missing.scheduled.size, 0);
  assert.equal(missing.target.count("visibilitychange"), 0);
  background.stop();
});

test("mobile editor content is clipped inside the window", () => {
  const env = harness({ width: 320, height: 568 });
  background.start(env.canvas, {});
  env.runFrame(1100);
  const [x, y, clipWidth, clipHeight] = env.calls.clipRect;
  assert.ok(clipWidth > 0 && clipHeight > 0);
  assert.ok(x >= 0 && y >= 0);
  assert.ok(x + clipWidth <= 320 && y + clipHeight <= 568);
  assert.match(moduleSource, /ctx\.clip\(\)/);
  background.stop();
});

test("feed reveals characters sequentially, increases caret count, throttles at 40ms, reports errors, and saves in green", () => {
  const env = harness();
  background.start(env.canvas, {});
  background.update({ working: 0, errors: 0 });
  let frameTime = 1100;
  env.runFrame(frameTime);
  const firstSnapshot = env.calls.snapshots.at(-1);
  const firstLine = env.codeLine(firstSnapshot);
  assert.ok(firstLine.length > 0 && firstLine.length < 44, `first frame reveals only a prefix: ${firstLine}`);
  assert.equal(env.caretCount(firstSnapshot), 1);

  const frameCount = env.calls.clear;
  env.runFrame(frameTime + 20);
  assert.equal(env.calls.clear, frameCount, "a frame inside the 40ms budget does not draw");
  env.runFrame(frameTime + 40);
  const nextSnapshot = env.calls.snapshots.at(-1);
  const nextLine = env.codeLine(nextSnapshot);
  assert.ok(nextLine.length > firstLine.length && nextLine.startsWith(firstLine), "the next frame extends the same character prefix");

  background.update({ working: 4, total: 5, engines: { codex: 3 }, kinds: { explorer: 1 }, errors: 1 });
  frameTime += 80;
  env.runFrame(frameTime);
  const busySnapshot = env.calls.snapshots.at(-1);
  assert.equal(env.caretCount(busySnapshot), 5, "working agents receive additional carets");
  assert.ok(busySnapshot.texts.some((entry) => entry.text.includes("Error Lens: check pending change")));
  background.update({ working: 0, total: 5, errors: 0 });
  frameTime += 60;
  env.runFrame(frameTime);
  const saved = env.calls.snapshots.at(-1).texts.find((entry) => entry.text === "✓ Saved");
  assert.ok(saved, JSON.stringify({ texts: env.calls.snapshots.at(-1).texts.map((entry) => entry.text), errors: env.calls.errors }));
  assert.equal(saved.fillStyle, env.values["--scene-string"], "saved feedback uses the green scene token");
  background.stop();
});

test("start without passed tokens survives 5-second feed polls and keeps repainting changing code", () => {
  const env = harness();
  background.start(env.canvas);
  const startClearCount = env.calls.clear;
  let pollCount = 0;
  for (let elapsed = 40; elapsed <= 10600; elapsed += 40) {
    if (elapsed === 5040 || elapsed === 10040) {
      pollCount += 1;
      background.update({ working: pollCount, total: 3, engines: { codex: pollCount }, errors: pollCount === 2 ? 1 : 0 });
      assert.equal(env.scheduled.size, 1, "a feed poll leaves exactly one frame pending");
    }
    const callbackTimestamp = elapsed === 40 ? undefined : elapsed === 80 ? Number.NaN : 1000 + elapsed;
    env.runFrame(1000 + elapsed, callbackTimestamp);
    assert.equal(env.scheduled.size, 1, "each animation tick schedules its successor");
  }
  const snapshots = env.calls.snapshots.slice(1);
  const lines = snapshots.map((snapshot) => env.codeLine(snapshot)).filter(Boolean);
  assert.equal(pollCount, 2, "two 5-second feed polls occurred during the simulated live interval");
  assert.ok(env.calls.clear - startClearCount >= 200, "many frames repainted over more than ten simulated seconds");
  assert.ok(lines.length > 20, "repaint snapshots contain visible code");
  assert.ok(lines.some((line) => line.length > 8), "typed code grows beyond its opening characters");
  assert.notEqual(lines[0], lines.at(-1), "later snapshots show changed code as typing/scrolling progresses");
  assert.equal(env.scheduled.size, 1, "the running visible instance retains one pending rAF");
  background.stop();
  assert.equal(env.scheduled.size, 0);
});

test("a transient Canvas exception is reported once, restores context state, and the next frame recovers", () => {
  const env = harness({ failFirstClippedText: true });
  background.start(env.canvas);
  assert.equal(env.scheduled.size, 1);
  env.runFrame(1200);
  assert.equal(env.calls.errors.length, 1, "the first failed draw is reported");
  assert.equal(env.calls.saveDepth, 0, "nested clipping and drawing saves are restored after failure");
  assert.equal(env.scheduled.size, 1, "a draw failure does not terminate the rAF chain");
  background.update({ working: 2, errors: 1 });
  assert.equal(env.scheduled.size, 1, "poll updates do not enqueue duplicate frames");
  env.runFrame(1240);
  assert.equal(env.calls.saveDepth, 0);
  assert.equal(env.calls.errors.length, 1, "one error is logged for the failure streak");
  assert.ok(env.codeLine(env.calls.snapshots.at(-1)).length > 0, "the recovered frame draws code");
  assert.equal(env.scheduled.size, 1);
  background.stop();
  assert.equal(env.scheduled.size, 0);
});

test("editor surfaces stay faint while syntax and carets remain distinctly visible", () => {
  const env = harness({ reduced: true });
  background.start(env.canvas);
  const surface = env.calls.paths.find((entry) => entry.type === "fill" && entry.fillStyle === env.values["--scene-editor"]);
  const border = env.calls.paths.find((entry) => entry.type === "stroke" && entry.strokeStyle === env.values["--scene-border"]);
  const header = env.calls.fills.find((entry) => entry.fillStyle === env.values["--scene-panel"] && entry.args[3] === 32);
  const syntax = env.calls.texts.find((entry) => entry.fillStyle === env.values["--scene-keyword"]);
  const caret = env.calls.fills.find((entry) => entry.fillStyle === env.values["--scene-accent"] && entry.args[2] === 2);
  const minimap = env.calls.fills.find((entry) => entry.fillStyle === env.values["--scene-keyword"] && entry.args[3] === 2);
  const vignette = env.calls.fills.find((entry) => entry.fillStyle?.gradient);
  assert.ok(surface && surface.alpha <= 0.10, "editor surface uses at most ten percent internal alpha");
  assert.ok(border && border.alpha <= 0.25, "border remains subdued");
  assert.ok(header && header.alpha <= 0.12, "header surface remains faint");
  assert.ok(syntax && syntax.alpha >= 0.30 && syntax.alpha <= 0.45, "syntax has a separate ghost-readable alpha");
  assert.ok(caret && caret.alpha >= 0.40 && caret.alpha <= 0.45, "caret is slightly more visible than syntax");
  assert.ok(minimap && minimap.alpha <= 0.16, "minimap remains faint");
  assert.ok(vignette && vignette.alpha <= 0.11, "vignette remains faint");
  assert.match(html, /--rain-opacity:\s*0\.85/);
  background.stop();
});

test("stop is idempotent, cancels scheduled work, and removes every listener", () => {
  const env = harness();
  background.start(env.canvas, {});
  assert.equal(env.target.count("visibilitychange"), 1);
  assert.equal(env.target.count("resize"), 1);
  assert.equal(env.media.count("change"), 1);
  assert.equal(env.scheduled.size, 1);
  background.stop();
  background.stop();
  assert.equal(env.scheduled.size, 0);
  assert.equal(env.target.count("visibilitychange"), 0);
  assert.equal(env.target.count("resize"), 0);
  assert.equal(env.media.count("change"), 0);
  assert.doesNotThrow(() => background.start({ getContext() { return null; } }, {}));
  background.stop();
});
