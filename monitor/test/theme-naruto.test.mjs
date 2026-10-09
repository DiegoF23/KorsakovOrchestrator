import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import narutoDusk from "../public/js/bg-naruto-dusk.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../index.html"), "utf8");
const sceneNames = ["sky-top", "sky-mid", "sky-bottom", "disc", "hill-back", "hill-mid", "hill-front", "leaf", "spiral", "clear"]
  .map((name) => `--scene-${name}`);

function setup({ reducedMotion = false, hidden = false } = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const queued = new Map();
  const calls = { scheduled: 0, cancelled: 0, clears: 0, fills: [], gradients: [], paintFilters: [], paletteReads: [] };
  const gradient = () => ({ addColorStop(offset, color) { calls.gradients.push({ offset, color }); } });
  const states = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    filter: "none",
    fillRect() { calls.fills.push(this.fillStyle); },
    clearRect() { calls.clears += 1; calls.fills = []; },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() { calls.fills.push(this.fillStyle); calls.paintFilters.push(this.filter); },
    stroke() { calls.fills.push(this.strokeStyle); },
    save() { states.push({ filter: this.filter, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, states.pop()); }, translate() {}, rotate() {}
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const add = (surface, name, callback) => listeners[surface].set(name, callback);
  const remove = (surface, name, callback) => {
    if (listeners[surface].get(name) === callback) listeners[surface].delete(name);
  };
  const colors = Object.fromEntries(sceneNames.map((name, index) => [`--scene-${name.slice(8)}`, `rgba(${40 + index}, 90, 150, 0.5)`]));
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
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
    const id = queued.size + calls.scheduled + 1;
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

function tokenBlock(id) {
  return html.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([\\s\\S]*?)\\n  \\}`))[1];
}

test("Naruto theme is prepainted, registered, and file-loads the dusk background", () => {
  assert.match(html, /var ids = \[[^\]]*"naruto"/);
  assert.match(html, /id: "naruto", name: "Naruto", background: "naruto-dusk"/);
  assert.match(html, /"naruto-dusk": "\/js\/bg-naruto-dusk\.mjs"/);
});

test("Naruto has the complete theme token set and requested palette", () => {
  const styles = [":root", "matrix", "claude-desktop", "bash", "naruto"].map((id) => id === ":root"
    ? html.match(/:root\s*\{([\s\S]*?)\n  \}/)[1]
    : tokenBlock(id));
  const names = (block) => Array.from(block.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]).sort();
  for (const block of styles.slice(1)) assert.deepEqual(names(block), names(styles[0]));
  const naruto = tokenBlock("naruto");
  for (const required of ["--bg: #0b1220", "--live: #f97316", "--branch-0: #f97316", "--branch-1: #2f6fed", "--font-ui: ui-sans-serif, system-ui, \"Segoe UI\", sans-serif", "--rail-style: line"]) {
    assert.ok(naruto.includes(required), `contains ${required}`);
  }
  for (const name of sceneNames) assert.ok(naruto.includes(`${name}:`), `contains ${name}`);
  assert.doesNotMatch(naruto, /(?:headband|leaf village|hidden leaf|symbol|logo)/i);
});

test("Naruto dusk scene reads only computed scene tokens and paints the layered scene", () => {
  const env = setup();
  narutoDusk.start(env.canvas, {});
  assert.deepEqual(env.calls.paletteReads, sceneNames);
  assert.equal(env.calls.scheduled, 1);
  const [id, callback] = env.queued.entries().next().value;
  env.queued.delete(id);
  callback(40);
  assert.ok(env.calls.fills.length > 10);
  assert.ok(env.calls.gradients.some((item) => Object.values(env.colors).includes(item.color)));
  assert.ok(env.calls.fills.some((fill) => Object.values(env.colors).includes(fill)));
  assert.ok(env.calls.gradients.every((stop) => Object.values(env.colors).includes(stop.color)));
  assert.equal(env.calls.paintFilters.slice(0, 6).length, 6);
  assert.ok(env.calls.paintFilters.slice(0, 6).every((filter) => /^blur\(\d+px\)$/.test(filter)), "all hill and roof silhouettes stay blurred");
  assert.ok(env.queued.size > 0);
  const [nextId, nextFrame] = env.queued.entries().next().value;
  env.queued.delete(nextId);
  const beforeEarlyFrame = env.calls.clears;
  nextFrame(55);
  assert.equal(env.calls.clears, beforeEarlyFrame, "frames less than 40 ms apart do not repaint");
  const [laterId, laterFrame] = env.queued.entries().next().value;
  env.queued.delete(laterId);
  laterFrame(80);
  assert.ok(env.calls.clears > beforeEarlyFrame);
  narutoDusk.stop();
  assert.equal(env.listeners.window.size, 0);
  assert.equal(env.listeners.document.size, 0);
  assert.equal(env.queued.size, 0);
});

test("Naruto dusk pauses while hidden, resumes, and removes every listener on stop", () => {
  const env = setup({ hidden: true });
  narutoDusk.start(env.canvas);
  assert.equal(env.calls.scheduled, 0);
  globalThis.document.hidden = false;
  env.listeners.document.get("visibilitychange")();
  assert.equal(env.calls.scheduled, 1);
  globalThis.document.hidden = true;
  env.listeners.document.get("visibilitychange")();
  assert.equal(env.queued.size, 0);
  assert.equal(env.calls.cancelled, 1);
  narutoDusk.stop();
  narutoDusk.stop();
  assert.equal(env.listeners.window.size, 0);
  assert.equal(env.listeners.document.size, 0);
});

test("Naruto dusk reduced-motion mode draws once, skips feed repaints, and refreshes on resize", () => {
  const env = setup({ reducedMotion: true });
  narutoDusk.start(env.canvas);
  const initialFills = env.calls.fills.length;
  assert.ok(initialFills > 0);
  assert.equal(env.calls.clears, 1, "reduced motion draws exactly one initial static frame");
  assert.equal(env.calls.scheduled, 0);
  narutoDusk.update({ working: 3 });
  assert.equal(env.calls.fills.length, initialFills);
  globalThis.window.innerHeight += 40;
  env.listeners.window.get("resize")();
  assert.ok(env.calls.clears > 0);
  assert.equal(env.calls.scheduled, 0);
  narutoDusk.stop();
});

test("Naruto dusk working feed updates spiral emphasis without scheduling extra frames", () => {
  const env = setup();
  narutoDusk.start(env.canvas);
  const scheduled = env.calls.scheduled;
  narutoDusk.update({ working: 2, total: 3 });
  assert.equal(env.calls.scheduled, scheduled);
  const [id, callback] = env.queued.entries().next().value;
  env.queued.delete(id);
  callback(40);
  assert.ok(env.calls.fills.length > 0);
  narutoDusk.stop();
});
