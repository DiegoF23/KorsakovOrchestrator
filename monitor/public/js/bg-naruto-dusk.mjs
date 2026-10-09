const SCENE_TOKENS = [
  "--scene-sky-top",
  "--scene-sky-mid",
  "--scene-sky-bottom",
  "--scene-disc",
  "--scene-hill-back",
  "--scene-hill-mid",
  "--scene-hill-front",
  "--scene-leaf",
  "--scene-spiral",
  "--scene-clear"
];

const FRAME_INTERVAL = 40;
const LEAF_COUNT = 7;

let canvas = null;
let context = null;
let frame = null;
let running = false;
let staticMode = false;
let lastFrame = 0;
let palette = {};
let working = 0;
let wallpaper = null;
let wallpaperLayer = null;
let wallpaperLoadId = 0;

// A personal wallpaper in monitor/public/img (git-ignored) replaces the drawn
// sky. It is rebuilt for any screen shape: a blurred, zoomed copy of the manga
// panels fills the whole canvas and the sharp fighters sit feathered on top.
const WALLPAPER_URLS = ["/img/naruto-wallpaper.webp", "/img/naruto-wallpaper.jpg", "/img/naruto-wallpaper.png"];
// Where the characters are inside the portrait image (fractions of its height).
const WALLPAPER_FOCUS_TOP = 0.2;
const WALLPAPER_FOCUS_BOTTOM = 0.93;

function loadWallpaper(index) {
  const loadId = wallpaperLoadId;
  if (index >= WALLPAPER_URLS.length || typeof Image !== "function") return;
  const image = new Image();
  image.onload = () => {
    if (!running || loadId !== wallpaperLoadId) return;
    wallpaper = image;
    buildWallpaperLayer();
    if (staticMode) draw(0);
  };
  image.onerror = () => {
    if (loadId === wallpaperLoadId) loadWallpaper(index + 1);
  };
  image.src = WALLPAPER_URLS[index];
}

function makeLayerCanvas(width, height) {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  return layer;
}

function buildWallpaperLayer() {
  if (!wallpaper || !canvas) return;
  const width = canvas.width;
  const height = canvas.height;
  const iw = wallpaper.naturalWidth || wallpaper.width;
  const ih = wallpaper.naturalHeight || wallpaper.height;
  if (!iw || !ih || width < 2 || height < 2) return;
  const layer = makeLayerCanvas(width, height);
  const ctx = layer.getContext("2d");

  // 1. Fill: the image zoomed to cover the width, from the middle of the panels, blurred.
  const cover = Math.max(width / iw, height / ih);
  const sliceH = Math.min(ih, height / cover);
  const sliceY = Math.max(0, Math.min(ih - sliceH, ih * 0.38 - sliceH / 2));
  ctx.save();
  ctx.filter = "blur(" + Math.max(6, Math.round(width / 90)) + "px)";
  ctx.drawImage(wallpaper, 0, sliceY, iw, sliceH, -20, -20, width + 40, height + 40);
  ctx.restore();

  // 2. A dusk veil so the page palette (navy and orange) rules over the black and white.
  ctx.fillStyle = color("--scene-sky-bottom");
  ctx.globalAlpha = 0.58;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.78, height * 0.3, 0, width * 0.78, height * 0.3, Math.max(width, height) * 0.6);
  glow.addColorStop(0, color("--scene-disc"));
  glow.addColorStop(1, color("--scene-clear"));
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  // 3. The sharp fighters: the focus band of the image, fitted to the height, feathered.
  const focusY = ih * WALLPAPER_FOCUS_TOP;
  const focusH = ih * (WALLPAPER_FOCUS_BOTTOM - WALLPAPER_FOCUS_TOP);
  const scale = (height * 1.04) / focusH;
  const figureW = iw * scale;
  const figureX = Math.round(width * 0.64 - figureW / 2);
  const figure = makeLayerCanvas(Math.ceil(figureW), height);
  const fctx = figure.getContext("2d");
  fctx.filter = "blur(1.2px)";
  fctx.drawImage(wallpaper, 0, focusY, iw, focusH, 0, -height * 0.02, figureW, height * 1.04);
  fctx.filter = "none";
  fctx.globalCompositeOperation = "destination-in";
  const fadeX = fctx.createLinearGradient(0, 0, figure.width, 0);
  fadeX.addColorStop(0, "rgba(0,0,0,0)");
  fadeX.addColorStop(0.18, "rgba(0,0,0,1)");
  fadeX.addColorStop(0.82, "rgba(0,0,0,1)");
  fadeX.addColorStop(1, "rgba(0,0,0,0)");
  fctx.fillStyle = fadeX;
  fctx.fillRect(0, 0, figure.width, height);
  const fadeY = fctx.createLinearGradient(0, 0, 0, height);
  fadeY.addColorStop(0, "rgba(0,0,0,0)");
  fadeY.addColorStop(0.12, "rgba(0,0,0,1)");
  fadeY.addColorStop(0.88, "rgba(0,0,0,1)");
  fadeY.addColorStop(1, "rgba(0,0,0,0)");
  fctx.fillStyle = fadeY;
  fctx.fillRect(0, 0, figure.width, height);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(figure, figureX, 0);
  ctx.globalAlpha = 1;

  // 4. Vignette toward the sides and bottom keeps the panels readable.
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, color("--scene-clear"));
  vignette.addColorStop(1, color("--scene-sky-bottom"));
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  wallpaperLayer = layer;
}

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  palette = Object.fromEntries(SCENE_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]));
}

function color(name) {
  return palette[name] || palette["--scene-clear"];
}

function drawHills(width, height) {
  const layers = [
    { fill: "--scene-hill-back", base: height * 0.76, peak: height * 0.53, shift: width * 0.2 },
    { fill: "--scene-hill-mid", base: height * 0.86, peak: height * 0.62, shift: width * 0.6 },
    { fill: "--scene-hill-front", base: height, peak: height * 0.7, shift: width * 0.32 }
  ];
  layers.forEach((layer, index) => {
    context.save();
    context.filter = `blur(${6 + index * 3}px)`;
    context.fillStyle = color(layer.fill);
    context.beginPath();
    context.moveTo(0, layer.base);
    context.quadraticCurveTo(width * 0.18, layer.peak, width * 0.38, layer.base - height * 0.02);
    context.quadraticCurveTo(width * 0.61, layer.peak + height * 0.12, width, layer.base - height * 0.04);
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
    context.fill();

    // Distant roof silhouettes keep the horizon original and non-literal.
    const roofY = layer.base - height * (0.08 + index * 0.025);
    context.beginPath();
    context.moveTo(layer.shift, roofY);
    context.lineTo(layer.shift + width * 0.055, roofY - height * 0.06);
    context.lineTo(layer.shift + width * 0.12, roofY);
    context.lineTo(layer.shift + width * 0.12, roofY + height * 0.07);
    context.lineTo(layer.shift, roofY + height * 0.07);
    context.closePath();
    context.fill();
    context.restore();
  });
}

function drawLeaves(width, height, time) {
  for (let index = 0; index < LEAF_COUNT; index += 1) {
    const progress = ((time * (0.000018 + index * 0.000002) + index / LEAF_COUNT) % 1);
    const x = (progress * 1.15 - 0.08) * width;
    const y = height * (0.22 + (index % 4) * 0.09) + Math.sin(time / 1500 + index) * 14;
    const size = Math.max(3, Math.min(width, height) * (0.009 + (index % 3) * 0.002));
    context.save();
    context.translate(x, y);
    context.rotate(Math.sin(time / 1200 + index) * 0.7);
    context.fillStyle = color("--scene-leaf");
    context.beginPath();
    context.moveTo(0, -size);
    context.quadraticCurveTo(size * 1.25, -size * 0.1, 0, size);
    context.quadraticCurveTo(-size * 1.1, size * 0.15, 0, -size);
    context.closePath();
    context.fill();
    context.restore();
  }
}

function drawSpiral(width, height, time) {
  const radius = Math.min(width, height) * 0.09;
  const centerX = width * 0.78;
  const centerY = height * 0.55;
  context.save();
  context.globalAlpha = working > 0 ? 0.85 : 0.55;
  context.strokeStyle = color("--scene-spiral");
  context.lineWidth = Math.max(2, radius * 0.035);
  context.filter = `blur(${working > 0 ? 3 : 5}px)`;
  context.beginPath();
  for (let step = 0; step <= 120; step += 1) {
    const angle = step / 120 * Math.PI * 4 + time / 12000;
    const distance = radius * step / 120;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    if (step === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function draw(time) {
  if (!context || !canvas) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  if (wallpaperLayer && wallpaperLayer.width === width && wallpaperLayer.height === height) {
    // A slow drift of the cached wallpaper (none under reduced motion).
    const seconds = staticMode ? 0 : time / 1000;
    const zoom = 1.035 + 0.01 * Math.sin(seconds / 11);
    const dx = (width * (zoom - 1)) / 2 + Math.sin(seconds / 9) * width * 0.012;
    const dy = (height * (zoom - 1)) / 2 + Math.cos(seconds / 13) * height * 0.01;
    context.drawImage(wallpaperLayer, -dx, -dy, width * zoom, height * zoom);
  } else {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, color("--scene-sky-top"));
    sky.addColorStop(0.55, color("--scene-sky-mid"));
    sky.addColorStop(1, color("--scene-sky-bottom"));
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    const disc = context.createRadialGradient(width * 0.76, height * 0.36, 0, width * 0.76, height * 0.36, Math.min(width, height) * 0.25);
    disc.addColorStop(0, color("--scene-disc"));
    disc.addColorStop(0.55, color("--scene-disc"));
    disc.addColorStop(1, color("--scene-clear"));
    context.fillStyle = disc;
    context.fillRect(0, 0, width, height);

    drawHills(width, height);
  }
  drawLeaves(width, height, time);
  drawSpiral(width, height, time);
}

function schedule() {
  if (running && !staticMode && !document.hidden && frame === null) frame = requestAnimationFrame(tick);
}

function tick(now) {
  frame = null;
  if (!running || staticMode || document.hidden) return;
  if (!lastFrame || now - lastFrame >= FRAME_INTERVAL) {
    lastFrame = now;
    draw(now);
  }
  schedule();
}

function resize() {
  if (!canvas || !context) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  buildWallpaperLayer();
  if (staticMode) draw(0);
}

function onResize() {
  resize();
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
  working = 0;
  wallpaper = null;
  wallpaperLayer = null;
  wallpaperLoadId += 1;
  loadWallpaper(0);
  lastFrame = 0;
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
  working = 0;
  palette = {};
  wallpaper = null;
  wallpaperLayer = null;
  wallpaperLoadId += 1;
}

function update(feed) {
  working = Math.max(0, Number(feed && feed.working) || 0);
}

export default { start, stop, resize, update };
