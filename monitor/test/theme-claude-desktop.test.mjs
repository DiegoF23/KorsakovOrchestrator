import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import claudeMascot from "../public/js/bg-claude-mascot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../index.html"), "utf8");
const sceneNames = [
  "creature", "creature-light", "creature-shadow", "accent", "spark",
  "bubble", "blueprint", "structure", "error", "clear"
].map((name) => `--scene-${name}`);

function setup({ reducedMotion = false, hidden = false } = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const queued = new Map();
  const calls = { scheduled: 0, cancelled: 0, rectangles: [], clears: 0, paletteReads: [], translations: [], rotations: [] };
  let nextId = 1;
  const context = {
    fillStyle: "",
    fillRect(x, y, width, height) { calls.rectangles.push({ color: this.fillStyle, x, y, width, height }); },
    clearRect() { calls.clears += 1; calls.rectangles = []; },
    save() {}, restore() {}, translate(x, y) { calls.translations.push({ x, y }); }, rotate(angle) { calls.rotations.push(angle); }, scale() {}
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const add = (surface, name, callback) => listeners[surface].set(name, callback);
  const remove = (surface, name, callback) => {
    if (listeners[surface].get(name) === callback) listeners[surface].delete(name);
  };
  const colors = Object.fromEntries(sceneNames.map((name, index) => [name, `rgb(${index + 20}, 80, 120)`]));
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (name, callback) => add("window", name, callback),
    removeEventListener: (name, callback) => remove("window", name, callback)
  };
  globalThis.document = {
    hidden,
    documentElement: {},
    addEventListener: (name, callback) => add("document", name, callback),
    removeEventListener: (name, callback) => remove("document", name, callback)
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue(name) { calls.paletteReads.push(name); return colors[name] || ""; } });
  globalThis.matchMedia = () => ({ matches: reducedMotion });
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queued.set(id, callback);
    calls.scheduled += 1;
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    queued.delete(id);
    calls.cancelled += 1;
  };
  return { canvas, calls, listeners, queued, colors };
}

function step(env, timestamp) {
  const [id, callback] = env.queued.entries().next().value;
  env.queued.delete(id);
  callback(timestamp);
}

test("Claude theme registers its file-loaded mascot and nonzero rain opacity", () => {
  assert.match(html, /id: "claude-desktop", name: "Claude Desktop", background: "claude-mascot"/);
  assert.match(html, /"claude-mascot": "\/js\/bg-claude-mascot\.mjs"/);
  const block = html.match(/:root\[data-theme="claude-desktop"\]\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(block, /--rain-opacity:\s*(?!0(?:\.0+)?;)[0-9.]+;/);
});

test("Claude scene token set is present in root and every existing theme block", () => {
  for (const selector of [":root", ':root[data-theme="matrix"]', ':root[data-theme="claude-desktop"]', ':root[data-theme="bash"]']) {
    const block = html.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n  \\}`))[1];
    for (const name of sceneNames) assert.match(block, new RegExp(`${name}:`), `${selector} contains ${name}`);
  }
});

test("Claude mascot consumes computed scene tokens and paints the pixel scene", () => {
  const env = setup();
  claudeMascot.start(env.canvas, {});
  assert.deepEqual(env.calls.paletteReads, sceneNames);
  assert.equal(env.calls.scheduled, 1);
  const [id, callback] = env.queued.entries().next().value;
  env.queued.delete(id);
  callback(40);
  assert.ok(env.calls.rectangles.length > 10);
  assert.ok(env.calls.rectangles.every((rect) => Object.values(env.colors).includes(rect.color)));
  assert.ok(env.queued.size > 0, "animation schedules its next bounded frame");
  const [nextId, nextFrame] = env.queued.entries().next().value;
  env.queued.delete(nextId);
  const beforeEarlyFrame = env.calls.clears;
  nextFrame(55);
  assert.equal(env.calls.clears, beforeEarlyFrame, "frames less than 40 ms apart do not repaint");
  const [laterId, laterFrame] = env.queued.entries().next().value;
  env.queued.delete(laterId);
  laterFrame(80);
  assert.ok(env.calls.clears > beforeEarlyFrame, "a later frame repaints after the throttle interval");
  claudeMascot.stop();
  assert.equal(env.listeners.window.size, 0);
  assert.equal(env.listeners.document.size, 0);
  assert.equal(env.queued.size, 0);
});

test("Claude mascot pauses while hidden, resumes when visible, and cleans up idempotently", () => {
  const env = setup({ hidden: true });
  claudeMascot.start(env.canvas);
  assert.equal(env.calls.scheduled, 0);
  globalThis.document.hidden = false;
  env.listeners.document.get("visibilitychange")();
  assert.equal(env.calls.scheduled, 1);
  globalThis.document.hidden = true;
  env.listeners.document.get("visibilitychange")();
  assert.equal(env.queued.size, 0);
  assert.equal(env.calls.cancelled, 1);
  claudeMascot.stop();
  claudeMascot.stop();
  assert.equal(env.listeners.window.size, 0);
  assert.equal(env.listeners.document.size, 0);
});

test("Claude mascot reduced-motion mode paints once and never schedules animation", () => {
  const env = setup({ reducedMotion: true });
  claudeMascot.start(env.canvas);
  const initialRects = env.calls.rectangles.length;
  assert.ok(initialRects > 0);
  assert.equal(env.calls.clears, 1, "reduced motion draws exactly one initial static frame");
  assert.equal(env.calls.scheduled, 0);
  claudeMascot.update({ working: 2, kinds: { EDIT: 1 }, errors: 1 });
  assert.equal(env.calls.rectangles.length, initialRects, "feed updates do not animate or repaint the static scene");
  globalThis.window.innerWidth += 20;
  env.listeners.window.get("resize")();
  assert.ok(env.calls.clears > 0, "resize refreshes the static scene");
  assert.equal(env.calls.scheduled, 0);
  claudeMascot.stop();
});

test("Claude idle mode strolls, hops, rolls, looks around, and naps with pixel Z glyphs", () => {
  const env = setup();
  claudeMascot.start(env.canvas);
  step(env, 40);
  const strollY = env.calls.translations.at(-1).y;
  step(env, 400);
  const hopY = env.calls.translations.at(-1).y;
  assert.ok(hopY < strollY - 15, "the hop has a distinct airborne arc");
  step(env, 750);
  assert.ok(env.calls.rotations.some((angle) => Math.abs(angle) > 0.5), "the rolling pose rotates the rectangle creature");
  step(env, 2000);
  const eyesBeforeLook = env.calls.rectangles.filter((rect) => rect.y === 16 && rect.width === 2).map((rect) => rect.x);
  step(env, 8000);
  const eyesDuringLook = env.calls.rectangles.filter((rect) => rect.y === 16 && rect.width === 2).map((rect) => rect.x);
  assert.notDeepEqual(eyesDuringLook, eyesBeforeLook, "the LOOK pose shifts the pixel pupils");
  step(env, 12000);
  assert.ok(env.calls.rectangles.some((rect) => rect.y === 16 && rect.width === 8 && rect.height === 2), "NAP closes both eyes");
  assert.ok(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-accent"] && rect.x === 66 && rect.y === 8 && rect.width === 12 && rect.height === 2), "NAP draws a blocky Z from rectangles");
  claudeMascot.stop();
});

test("Claude READ visibly unrolls paper before studying it", () => {
  const env = setup();
  claudeMascot.start(env.canvas);
  claudeMascot.update({ working: 1, kinds: { READ: 1 } });
  step(env, 40);
  const narrowPaper = env.calls.rectangles.find((rect) => rect.color === env.colors["--scene-bubble"] && rect.y === 27).width;
  step(env, 1600);
  const openPaper = env.calls.rectangles.find((rect) => rect.color === env.colors["--scene-bubble"] && rect.y === 27).width;
  assert.ok(openPaper > narrowPaper * 2, "paper grows from a rolled strip to an open page");
  claudeMascot.stop();
});

test("Claude shows one transient error pose while idle, then returns to normal despite a steady error count", () => {
  const env = setup();
  claudeMascot.start(env.canvas);
  claudeMascot.update({ working: 0, errors: 1 });
  step(env, 40);
  assert.ok(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-error"]), "idle error state has a sweat cue");
  step(env, 1800);
  assert.equal(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-error"]), false, "the cue expires");
  claudeMascot.update({ working: 1, kinds: { CMD: 1 }, errors: 1 });
  step(env, 2200);
  assert.equal(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-error"]), false, "steady feed errors do not retrigger the cue");
  assert.ok(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-blueprint"]), "the scene returns to its active CMD task");
  claudeMascot.stop();
});

test("Claude mascot feed selects task props, caps helpers, and shows transient error details", () => {
  const env = setup();
  claudeMascot.start(env.canvas);
  claudeMascot.update({ working: 9, kinds: { EDIT: 1 }, errors: 1 });
  const [id, callback] = env.queued.entries().next().value;
  env.queued.delete(id);
  callback(40);
  const sceneColors = new Set(Object.values(env.colors));
  assert.ok(env.calls.rectangles.length > 80, "main character plus no more than four helper characters are rendered");
  assert.ok(env.calls.rectangles.every((rect) => sceneColors.has(rect.color)));
  assert.ok(env.calls.rectangles.some((rect) => rect.color === env.colors["--scene-error"]));
  claudeMascot.stop();
});
