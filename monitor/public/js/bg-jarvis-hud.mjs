const SCENE_TOKENS = [
  "--scene-primary",
  "--scene-secondary",
  "--scene-accent",
  "--scene-alert",
  "--scene-grid",
  "--scene-glint"
];

// All faint strokes share one boost so the HUD stays visible behind panels.
const ALPHA_BOOST = 2;
function boost(alpha) {
  return Math.min(1, alpha * ALPHA_BOOST);
}

const MAX_FRAME_INTERVAL = 1000 / 30;
const HEX_HEIGHT = 24;

let canvas = null;
let context = null;
let width = 0;
let height = 0;
let frame = null;
let lastFrame = 0;
let running = false;
let reducedMotion = false;
let feed = { working: 0, errors: 0 };
let colors = {};

function readColors() {
  const root = document.documentElement;
  const style = typeof window.getComputedStyle === "function"
    ? window.getComputedStyle(root)
    : getComputedStyle(root);
  const next = {};
  for (const name of SCENE_TOKENS) {
    next[name] = style.getPropertyValue(name).trim() || "currentColor";
  }
  return next;
}

function resizeCanvas() {
  if (!canvas) return;
  width = Math.max(1, window.innerWidth || canvas.clientWidth || 1);
  height = Math.max(1, window.innerHeight || canvas.clientHeight || 1);
  canvas.width = width;
  canvas.height = height;
}

function pathHex(cx, cy, radius) {
  context.beginPath();
  for (let point = 0; point < 6; point += 1) {
    const angle = Math.PI / 3 * point + Math.PI / 6;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function drawHexGrid(time) {
  const drift = (time * 0.008) % HEX_HEIGHT;
  const radius = 8;
  const columnStep = radius * 1.72;
  context.strokeStyle = colors["--scene-grid"];
  context.lineWidth = 0.65;
  context.globalAlpha = boost(0.12);
  for (let row = -1; row * HEX_HEIGHT < height + HEX_HEIGHT; row += 1) {
    const y = row * HEX_HEIGHT + drift;
    const offset = row % 2 ? columnStep / 2 : 0;
    for (let column = -1; column * columnStep < width + columnStep; column += 1) {
      pathHex(column * columnStep + offset, y, radius);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

function drawReactor(time) {
  const cx = width * 0.79;
  const cy = height * 0.77;
  const radius = Math.max(36, Math.min(width, height) * 0.17);
  const working = Math.max(0, Number(feed.working) || 0);
  const speed = 0.00012 * (working ? 1 + Math.min(working, 8) * 0.28 : 1);
  const rotation = time * speed;
  const pulse = working > 0 ? (time * speed * 1.7) % 1 : -1;

  context.save();
  context.translate(cx, cy);
  context.rotate(rotation);
  context.strokeStyle = colors["--scene-primary"];
  context.lineWidth = 1;
  context.globalAlpha = boost(0.2);
  for (const scale of [1, 0.82, 0.59, 0.34]) {
    context.beginPath();
    context.arc(0, 0, radius * scale, 0, Math.PI * 2);
    context.stroke();
  }

  context.strokeStyle = colors["--scene-secondary"];
  context.lineWidth = 1.2;
  context.globalAlpha = boost(0.3);
  context.beginPath();
  context.arc(0, 0, radius * 0.92, rotation * -1, rotation * -1 + Math.PI * 1.25);
  context.stroke();

  context.strokeStyle = colors["--scene-glint"];
  context.lineWidth = 1.4;
  context.globalAlpha = boost(0.24);
  const tickCount = 48;
  for (let tick = 0; tick < tickCount; tick += 1) {
    const angle = tick / tickCount * Math.PI * 2;
    const major = tick % 4 === 0;
    const inner = radius * (major ? 0.88 : 0.93);
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    context.stroke();
  }

  if (pulse >= 0) {
    context.strokeStyle = colors["--scene-accent"];
    context.lineWidth = 2;
    context.globalAlpha = boost(0.26);
    context.beginPath();
    context.arc(0, 0, radius * (0.35 + pulse * 0.62), rotation, rotation + Math.PI * 0.24);
    context.stroke();
  }
  context.restore();
  context.globalAlpha = 1;
}

function drawRadar(time) {
  const cx = width * 0.79;
  const cy = height * 0.77;
  const radius = Math.max(36, Math.min(width, height) * 0.17) * 0.8;
  const angle = time * 0.00016;
  context.save();
  context.translate(cx, cy);
  context.rotate(angle);
  context.strokeStyle = colors["--scene-primary"];
  context.lineWidth = 1;
  context.globalAlpha = boost(0.16);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(radius, 0);
  context.stroke();
  context.globalAlpha = boost(0.08);
  context.beginPath();
  context.arc(0, 0, radius, -0.22, 0.22);
  context.stroke();
  context.restore();
  context.globalAlpha = 1;
}

function drawScanLines(time) {
  const y = (time * 0.035) % Math.max(1, height);
  context.strokeStyle = colors["--scene-secondary"];
  context.lineWidth = 1;
  context.globalAlpha = boost(0.12);
  context.beginPath();
  context.moveTo(0, y);
  context.lineTo(width, y);
  context.stroke();
  context.globalAlpha = 1;
}

function drawReadouts(time) {
  const phase = Math.floor(time / 1800);
  const value = ((phase * 7919 + 1049) % 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const percent = (phase * 13 + 37) % 100;
  const drift = Math.sin(time * 0.0004) * 7;
  context.font = "10px monospace";
  context.textAlign = "left";
  context.fillStyle = colors["--scene-secondary"];
  context.globalAlpha = boost(0.3);
  context.fillText("SYS " + value, width * 0.66 + drift, height * 0.28);
  context.fillStyle = colors["--scene-primary"];
  context.fillText("CORE " + percent + "%", width * 0.69 - drift, height * 0.32);
  context.globalAlpha = 1;
}

function drawCornerBrackets() {
  const inset = 18;
  const length = 23;
  const corners = [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [inset, height - inset, 1, -1],
    [width - inset, height - inset, -1, -1]
  ];
  context.strokeStyle = colors["--scene-primary"];
  context.lineWidth = 1;
  context.globalAlpha = boost(0.18);
  for (const [x, y, horizontal, vertical] of corners) {
    context.beginPath();
    context.moveTo(x + horizontal * length, y);
    context.lineTo(x, y);
    context.lineTo(x, y + vertical * length);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawErrorIndicator(time) {
  if (!(Number(feed.errors) > 0)) return;
  const flicker = Math.sin(time * 0.018) > -0.35;
  context.fillStyle = colors[flicker ? "--scene-alert" : "--scene-accent"];
  context.globalAlpha = boost(flicker ? 0.34 : 0.16);
  context.fillRect(width * 0.77, height * 0.54, 5, 5);
  context.globalAlpha = 1;
}

function draw(time) {
  if (!context || !canvas) return;
  context.clearRect(0, 0, width, height);
  drawHexGrid(time);
  drawReactor(time);
  drawRadar(time);
  drawScanLines(time);
  drawReadouts(time);
  drawCornerBrackets();
  drawErrorIndicator(time);
}

function schedule() {
  if (!running || reducedMotion || document.hidden || frame !== null) return;
  frame = window.requestAnimationFrame(onFrame);
}

function onFrame(time) {
  frame = null;
  if (!running || document.hidden || reducedMotion) return;
  if (time - lastFrame >= MAX_FRAME_INTERVAL) {
    lastFrame = time;
    draw(time);
  }
  schedule();
}

function onVisibilityChange() {
  if (!running || reducedMotion) return;
  if (document.hidden) {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  } else {
    lastFrame = 0;
    schedule();
  }
}

function onResize() {
  resizeCanvas();
  draw(reducedMotion ? 0 : lastFrame);
}

function stop() {
  running = false;
  if (frame !== null) window.cancelAnimationFrame(frame);
  frame = null;
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
  canvas = null;
  context = null;
  width = 0;
  height = 0;
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
  colors = readColors();
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  running = true;
  lastFrame = 0;
  feed = { working: 0, errors: 0 };
  resizeCanvas();
  draw(0);
  window.addEventListener("resize", onResize);
  if (reducedMotion) return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule();
}

function resize() {
  if (!canvas) return;
  resizeCanvas();
  draw(reducedMotion ? 0 : lastFrame);
}

function update(nextFeed) {
  feed = {
    working: Math.max(0, Number(nextFeed && nextFeed.working) || 0),
    errors: Math.max(0, Number(nextFeed && nextFeed.errors) || 0)
  };
}

export default { start, stop, resize, update };
