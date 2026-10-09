import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hud from "../public/js/bg-jarvis-hud.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const source = fs.readFileSync(path.join(here, "..", "public", "js", "bg-jarvis-hud.mjs"), "utf8");
const sceneTokens = [
  "--scene-primary",
  "--scene-secondary",
  "--scene-accent",
  "--scene-alert",
  "--scene-grid",
  "--scene-glint"
];

function themeBlock(id) {
  const match = html.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(match, `theme block exists for ${id}`);
  return match[1];
}

function declarations(block) {
  return new Set(Array.from(block.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]));
}

function createHarness({ hidden = false, reduced = false } = {}) {
  const callbacks = new Map();
  const listeners = new Map();
  const canceled = [];
  const contextCalls = [];
  const context = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name === "string" && name in Object.prototype) return Object.prototype[name];
      return (...args) => contextCalls.push([name, ...args]);
    },
    set(target, name, value) {
      target[name] = value;
      contextCalls.push([`set:${String(name)}`, value]);
      return true;
    }
  });
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 320,
    clientHeight: 240,
    getContext(kind) {
      assert.equal(kind, "2d");
      return context;
    }
  };
  const document = {
    hidden,
    documentElement: {},
    addEventListener(name, listener) {
      listeners.set(`document:${name}`, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(`document:${name}`) === listener) listeners.delete(`document:${name}`);
    }
  };
  const window = {
    innerWidth: 320,
    innerHeight: 240,
    addEventListener(name, listener) {
      listeners.set(`window:${name}`, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(`window:${name}`) === listener) listeners.delete(`window:${name}`);
    },
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reduced };
    },
    requestAnimationFrame(callback) {
      const id = callbacks.size + canceled.length + 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      canceled.push(id);
      callbacks.delete(id);
    }
  };
  const computedTokens = new Map(sceneTokens.map((token) => [token, `var(${token})`]));
  globalThis.window = window;
  globalThis.document = document;
  globalThis.getComputedStyle = (element) => {
    assert.equal(element, document.documentElement);
    return { getPropertyValue: (name) => computedTokens.get(name) || "" };
  };
  return {
    canvas,
    callbacks,
    canceled,
    contextCalls,
    document,
    listeners,
    window,
    runFrame(id, time) {
      const callback = callbacks.get(id);
      assert.ok(callback, `RAF ${id} was scheduled`);
      callbacks.delete(id);
      callback(time);
    },
    restore() {
      hud.stop();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.getComputedStyle;
    }
  };
}

test("JARVIS is registered and its standalone module exposes the background API", () => {
  assert.match(html, /\{\s*id:\s*"jarvis",\s*name:\s*"JARVIS",\s*background:\s*"jarvis-hud"\s*\}/);
  assert.match(html, /"jarvis-hud":\s*"\/js\/bg-jarvis-hud\.mjs"/);
  for (const method of ["start", "stop", "resize", "update"]) {
    assert.equal(typeof hud[method], "function", `${method} is exported`);
  }
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\brgba?\s*\(/i, "the module contains no hard-coded colors");
});

test("JARVIS defines the complete Matrix token set and all HUD scene colors", () => {
  const matrix = declarations(themeBlock("matrix"));
  const jarvis = declarations(themeBlock("jarvis"));
  assert.deepEqual([...jarvis].sort(), [...matrix].sort());
  for (const name of sceneTokens) assert.ok(jarvis.has(name), `${name} is defined`);
  for (const name of sceneTokens) assert.ok(source.includes(`"${name}"`), `${name} is read from CSS`);
});

test("the module reads computed theme colors, draws the HUD and caps animation at 30 fps", () => {
  const harness = createHarness();
  try {
    hud.start(harness.canvas, {});
    assert.equal(harness.canvas.width, 320);
    assert.equal(harness.canvas.height, 240);
    assert.equal(harness.contextCalls.filter(([name]) => name === "clearRect").length, 1);
    assert.ok(harness.contextCalls.some(([name]) => name === "arc"), "reactor rings and radar are drawn");
    assert.ok(harness.contextCalls.some(([name]) => name === "fillText"), "numeric readouts are drawn");
    assert.ok(harness.contextCalls.some(([name]) => name === "lineTo"), "grid and corner brackets are drawn");

    let time = 16;
    for (let tick = 0; tick < 60; tick += 1) {
      const id = harness.callbacks.keys().next().value;
      assert.ok(id, "the animation schedules its next frame");
      harness.runFrame(id, time);
      time += 1000 / 60;
    }
    assert.ok(harness.contextCalls.filter(([name]) => name === "clearRect").length <= 31,
      "at most 30 animation frames are drawn per second, plus initial static frame");
  } finally {
    harness.restore();
  }
});

test("reduced motion stays static but redraws at time zero on resize and cleans up", () => {
  const harness = createHarness({ reduced: true });
  try {
    hud.start(harness.canvas);
    assert.deepEqual([...harness.listeners.keys()], ["window:resize"]);
    hud.update({ working: 7, errors: 2 });
    assert.equal(harness.contextCalls.filter(([name]) => name === "clearRect").length, 1);
    assert.equal(harness.callbacks.size, 0);
    assert.ok(!harness.contextCalls.some(([name, value]) => name === "set:strokeStyle" && value === "var(--scene-accent)"),
      "feed updates do not animate the reduced-motion frame");

    hud.resize();
    assert.equal(harness.contextCalls.filter(([name]) => name === "clearRect").length, 2,
      "explicit resize redraws the static frame");
    harness.window.innerWidth = 640;
    harness.window.innerHeight = 480;
    harness.listeners.get("window:resize")();
    assert.equal(harness.canvas.width, 640);
    assert.equal(harness.canvas.height, 480);
    assert.equal(harness.contextCalls.filter(([name]) => name === "clearRect").length, 3,
      "window resize redraws the static frame");
    assert.equal(harness.callbacks.size, 0);

    hud.stop();
    assert.equal(harness.listeners.size, 0);
  } finally {
    harness.restore();
  }
});

test("hidden documents pause frames and becoming visible resumes the animation", () => {
  const harness = createHarness({ hidden: true });
  try {
    hud.start(harness.canvas);
    assert.equal(harness.callbacks.size, 0);
    const visibility = harness.listeners.get("document:visibilitychange");
    assert.equal(typeof visibility, "function");

    harness.document.hidden = false;
    visibility();
    assert.equal(harness.callbacks.size, 1);
    const frame = harness.callbacks.keys().next().value;
    harness.document.hidden = true;
    visibility();
    assert.equal(harness.callbacks.size, 0);
    assert.deepEqual(harness.canceled, [frame]);
  } finally {
    harness.restore();
  }
});

test("stop cancels a pending frame, removes listeners and allows a clean restart", () => {
  const harness = createHarness();
  try {
    hud.start(harness.canvas);
    const frame = harness.callbacks.keys().next().value;
    assert.equal(harness.listeners.size, 2);
    hud.stop();
    assert.deepEqual(harness.canceled, [frame]);
    assert.equal(harness.callbacks.size, 0);
    assert.equal(harness.listeners.size, 0);

    hud.start(harness.canvas);
    assert.equal(harness.listeners.size, 2);
    assert.equal(harness.callbacks.size, 1);
  } finally {
    harness.restore();
  }
});

test("working activity and errors change the animated HUD state", () => {
  const harness = createHarness();
  try {
    hud.start(harness.canvas);
    hud.update({ working: 4, errors: 2, engines: { codex: 4 } });
    const first = harness.callbacks.keys().next().value;
    harness.runFrame(first, 100);
    assert.ok(harness.contextCalls.some(([name, value]) => name === "set:strokeStyle" && value === "var(--scene-accent)"));
    assert.ok(harness.contextCalls.some(([name, value]) => name === "set:fillStyle" && value === "var(--scene-alert)"));
  } finally {
    harness.restore();
  }
});
