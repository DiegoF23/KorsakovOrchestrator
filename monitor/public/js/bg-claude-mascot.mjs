const SCENE_TOKENS = [
  "--scene-creature",
  "--scene-creature-light",
  "--scene-creature-shadow",
  "--scene-accent",
  "--scene-spark",
  "--scene-bubble",
  "--scene-blueprint",
  "--scene-structure",
  "--scene-error",
  "--scene-clear"
];

const FRAME_INTERVAL = 40;
const MAX_HELPERS = 4;

let canvas = null;
let context = null;
let frame = null;
let running = false;
let staticMode = false;
let lastFrame = 0;
let elapsed = 0;
let errorUntil = 0;
let feed = { working: 0, kinds: {}, errors: 0 };
let palette = {};

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  palette = Object.fromEntries(SCENE_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]));
}

function color(name) {
  return palette[name] || palette["--scene-clear"];
}

function rect(fill, x, y, width, height) {
  context.fillStyle = color(fill);
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function bubble(x, y, width, height, fill) {
  rect(fill, x, y, width, height);
  rect(fill, x + 5, y + height, 5, 5);
  rect(fill, x + 10, y + height + 5, 4, 4);
}

function drawZ(x, y, unit, fill) {
  rect(fill, x, y, unit * 6, unit);
  rect(fill, x + unit * 5, y + unit, unit, unit);
  rect(fill, x + unit * 4, y + unit * 2, unit, unit);
  rect(fill, x + unit * 3, y + unit * 3, unit, unit);
  rect(fill, x + unit * 2, y + unit * 4, unit, unit);
  rect(fill, x, y + unit * 5, unit * 6, unit);
}

function drawCreature(x, y, scale, activity, time, isError = false, pose = {}) {
  context.save();
  context.translate(x, y + Math.sin(time / 500) * 3 + (pose.hopY || 0));
  if (pose.type === "ROLL") context.rotate(pose.angle || 0);
  context.scale(scale, scale);
  const glance = pose.type === "LOOK" ? Math.floor(time / 320) % 3 - 1 : Math.floor(time / 950) % 3 - 1;

  // A friendly pixel creature built exclusively from rectangles.
  rect("--scene-creature-shadow", 5, 50, 50, 8);
  rect("--scene-creature", 10, 18, 40, 32);
  rect("--scene-creature", 17, 8, 26, 14);
  if (pose.type === "NAP") {
    rect("--scene-creature-shadow", 22, 16, 8, 2);
    rect("--scene-creature-shadow", 37, 16, 8, 2);
  } else {
    rect("--scene-creature-light", 22, 14, 5, 5);
    rect("--scene-creature-light", 37, 14, 5, 5);
    rect("--scene-creature-shadow", 23 + glance, 16, 2, 2);
    rect("--scene-creature-shadow", 38 + glance, 16, 2, 2);
  }
  rect("--scene-creature-light", 18, 44, 8, 8);
  rect("--scene-creature-light", 35, 44, 8, 8);
  rect("--scene-creature-shadow", 3, 28, 8, 8);
  rect("--scene-creature", 0, 22, 7, 12);
  rect("--scene-creature-shadow", 49, 25, 9, 8);
  rect("--scene-creature", 54, 20, 7, 13);

  if (activity === "CMD") {
    rect("--scene-blueprint", 5, 55, 58, 5);
    rect("--scene-blueprint", 12, 39, 42, 16);
    rect("--scene-creature-shadow", 16, 42, 34, 8);
    rect("--scene-accent", 20 + Math.floor(time / 130) % 4 * 5, 43, 4, 3);
    rect("--scene-creature-light", 26, 54, 16, 3);
  } else if (activity === "EDIT") {
    const height = 8 + Math.floor((time / 380) % 5) * 4;
    rect("--scene-structure", 65, 55 - height, 22, height);
    rect("--scene-structure", 68, 49 - height, 16, 5);
    rect("--scene-spark", 62 + Math.floor(time / 190) % 16, 39 - height, 3, 3);
    rect("--scene-creature-shadow", 11 + Math.floor(time / 210) % 5, 28, 3, 16);
    rect("--scene-spark", 7 + Math.floor(time / 210) % 5, 26, 12, 4);
  } else if (activity === "READ") {
    const progress = Math.min(1, (time % 3200) / 1600);
    const paperWidth = 9 + progress * 27;
    const paperX = 64 + (36 - paperWidth) / 2;
    rect("--scene-bubble", paperX, 27, paperWidth, 24);
    rect("--scene-creature-light", paperX + 3, 30, Math.max(2, paperWidth - 6), 18);
    rect("--scene-creature-shadow", paperX, 29, 3, 20);
    rect("--scene-creature-shadow", paperX + paperWidth - 3, 29, 3, 20);
    const lineWidth = Math.max(2, paperWidth - 13);
    rect("--scene-accent", paperX + 7, 34, lineWidth, 2);
    rect("--scene-accent", paperX + 7, 40, Math.max(2, lineWidth - 4), 2);
  } else if (activity === "MSG") {
    bubble(65, 10, 28, 18, "--scene-bubble");
    const dots = 1 + Math.floor(time / 430) % 3;
    for (let index = 0; index < dots; index += 1) rect("--scene-accent", 71 + index * 7, 17, 4, 4);
  } else if (activity === "IDLE") {
    if (pose.type === "NAP") {
      drawZ(66, 8, 2, "--scene-accent");
      drawZ(81, 2, 1, "--scene-accent");
    }
  } else {
    bubble(66, 8, 18, 14, "--scene-bubble");
    rect("--scene-accent", 72, 11, 3, 8);
    rect("--scene-accent", 72, 20, 3, 3);
  }

  if (isError) {
    rect("--scene-error", 48, 4, 4, 4);
    rect("--scene-error", 45, 8, 7, 4);
    rect("--scene-error", 47, 12, 5, 4);
    rect("--scene-error", 49, 16, 3, 3);
  }
  context.restore();
}

function idlePose(time) {
  const cycle = time % 18000;
  if (cycle < 7200) {
    const beat = cycle % 2400;
    if (beat < 650) {
      return { type: "HOP", hopY: -Math.sin(beat / 650 * Math.PI) * 28, xOffset: cycle / 7200 };
    }
    if (beat < 1100) {
      return { type: "ROLL", angle: (beat - 650) / 450 * Math.PI * 2, xOffset: cycle / 7200 };
    }
    return { type: "STROLL", xOffset: cycle / 7200 };
  }
  if (cycle < 9800) return { type: "LOOK", xOffset: 1 };
  return { type: "NAP", xOffset: 0.5 };
}

function currentActivity() {
  const kinds = feed.kinds || {};
  return ["CMD", "EDIT", "READ", "MSG"].find((kind) => kinds[kind] > 0) || "CMD";
}

function draw(now) {
  if (!running || !context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const scale = Math.max(0.75, Math.min(1.35, Math.min(width / 1120, height / 720)));
  const baseY = Math.max(16, height * 0.53);
  const working = Math.max(0, Number(feed.working) || 0);
  if (working === 0) {
    const pose = idlePose(now);
    const stroll = width * (0.24 + pose.xOffset * 0.42);
    drawCreature(stroll, baseY, scale, "IDLE", now, now < errorUntil, pose);
  } else {
    drawCreature(width * 0.42, baseY, scale, currentActivity(), now, now < errorUntil);
    const helpers = Math.min(MAX_HELPERS, Math.max(0, working - 1));
    for (let index = 0; index < helpers; index += 1) {
      const x = width * (0.54 + index * 0.075);
      drawCreature(x, baseY + (index % 2) * 12, scale * 0.68, currentActivity(), now + index * 170, false);
    }
  }
}

function schedule() {
  if (running && !staticMode && !document.hidden && frame === null) {
    frame = requestAnimationFrame(tick);
  }
}

function tick(now) {
  frame = null;
  if (!running || staticMode || document.hidden) return;
  if (!lastFrame || now - lastFrame >= FRAME_INTERVAL) {
    const delta = lastFrame ? now - lastFrame : FRAME_INTERVAL;
    elapsed += delta;
    lastFrame = now;
    if (elapsed >= errorUntil) errorUntil = 0;
    draw(elapsed);
  }
  schedule();
}

function resize() {
  if (!canvas || !context) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (staticMode) draw(0);
}

function onVisibilityChange() {
  if (!running) return;
  if (document.hidden) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  } else {
    lastFrame = 0;
    schedule();
  }
}

function onResize() {
  resize();
}

function start(nextCanvas) {
  stop();
  if (!nextCanvas || typeof nextCanvas.getContext !== "function") return;
  canvas = nextCanvas;
  context = canvas.getContext("2d");
  if (!context) {
    canvas = null;
    return;
  }
  readPalette();
  running = true;
  lastFrame = 0;
  elapsed = 0;
  errorUntil = 0;
  staticMode = matchMedia("(prefers-reduced-motion: reduce)").matches;
  resize();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule();
}

function stop() {
  running = false;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  canvas = null;
  context = null;
  staticMode = false;
  lastFrame = 0;
  elapsed = 0;
  errorUntil = 0;
  feed = { working: 0, kinds: {}, errors: 0 };
  palette = {};
}

function update(nextFeed) {
  const updatedFeed = nextFeed && typeof nextFeed === "object"
    ? { working: Number(nextFeed.working) || 0, kinds: nextFeed.kinds || {}, errors: Number(nextFeed.errors) || 0 }
    : { working: 0, kinds: {}, errors: 0 };
  if (updatedFeed.errors > feed.errors && running) errorUntil = elapsed + 1400;
  feed = updatedFeed;
}

export default { start, stop, resize, update };
