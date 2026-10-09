const FRAME_INTERVAL = 40;
const SCENE_KEYS = [
  "--scene-editor", "--scene-panel", "--scene-border", "--scene-text", "--scene-dim",
  "--scene-keyword", "--scene-string", "--scene-function", "--scene-number",
  "--scene-type", "--scene-error", "--scene-cyan", "--scene-accent",
  "--scene-mono-font", "--scene-title-font", "--scene-transparent"
];
const SCENE_COLOR_KEYS = SCENE_KEYS.filter((key) => !key.endsWith("-font"));

const snippets = [
  [["keyword", "const"], ["text", " projects = await "], ["function", "loadProjects"], ["bracket", "()"], ["text", " { return projects; }"]],
  [["keyword", "export function "], ["function", "renderWorker"], ["bracket", "( "], ["type", "worker"], ["bracket", ") {"], ["keyword", " return "], ["type", "WorkerCard"], ["bracket", "; }" ]],
  [["keyword", "const "], ["text", "theme = "], ["bracket", "{"], ["text", " editor: "], ["string", "tokens.accent"], ["bracket", " };"]],
  [["selector", ".worker "], ["bracket", "{"], ["text", " color: "], ["keyword", "var"], ["bracket", "("], ["string", "--scene-text"], ["bracket", "); }" ]],
  [["bracket", "{"], ["string", "\"background\": \"vscode-ghost\""], ["text", ", "], ["string", "\"enabled\": "], ["number", "true"], ["bracket", "}"]],
  [["keyword", "function "], ["function", "updateStatus"], ["bracket", "("], ["type", "state"], ["bracket", ") {"], ["keyword", " return "], ["text", "state.label"], ["bracket", "; }"]]
];

const colors = Object.freeze({
  text: "--scene-text", dim: "--scene-dim", keyword: "--scene-keyword", string: "--scene-string",
  function: "--scene-function", number: "--scene-number", type: "--scene-type",
  error: "--scene-error", cyan: "--scene-cyan", accent: "--scene-accent", selector: "--scene-cyan"
});

const state = {
  canvas: null, context: null, running: false, raf: null, lastFrame: 0,
  hidden: false, reduced: false, staticDrawn: false, staticDirty: false, media: null,
  feed: { working: 0, total: 0, engines: {}, kinds: {}, errors: 0 },
  previousWorking: 0, savedAt: 0, startedAt: 0, caretOffset: 0, tokens: {}, listeners: [],
  drawFailureReported: false
};

function clockNow() {
  const now = globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now()
    : Date.now();
  return Number.isFinite(now) ? now : Date.now();
}

function readSceneTokens() {
  const style = globalThis.getComputedStyle(globalThis.document.documentElement);
  const values = {};
  for (const key of SCENE_KEYS) values[key] = style.getPropertyValue(key).trim();
  values["--rain-opacity"] = style.getPropertyValue("--rain-opacity").trim();
  return values;
}

function resizeCanvas() {
  if (!state.canvas) return;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, globalThis.innerWidth || state.canvas.clientWidth || 1);
  const height = Math.max(1, globalThis.innerHeight || state.canvas.clientHeight || 1);
  state.canvas.width = Math.round(width * dpr);
  state.canvas.height = Math.round(height * dpr);
  if (state.context && typeof state.context.setTransform === "function") state.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.reduced) {
    state.staticDirty = true;
    if (!state.hidden) drawStaticFrame(true);
  }
}

function clearFrame() {
  const ctx = state.context;
  if (!ctx || !state.canvas) return;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  ctx.clearRect(0, 0, state.canvas.width / dpr, state.canvas.height / dpr);
}

function drawFrame(now, staticFrame = false) {
  const ctx = state.context;
  if (!ctx || !state.canvas) return;
  const width = state.canvas.width / Math.min(globalThis.devicePixelRatio || 1, 2);
  const height = state.canvas.height / Math.min(globalThis.devicePixelRatio || 1, 2);
  if (width < 240 || height < 140) {
    clearFrame();
    return false;
  }
  if (SCENE_COLOR_KEYS.some((key) => !state.tokens[key])) return false;
  clearFrame();
  ctx.save();
  try {
    // #rain owns theme opacity; internal alpha keeps surfaces faint and code legible.
    ctx.globalAlpha = 1;
    const margin = Math.max(24, width * 0.08);
    const panelWidth = Math.min(width - margin * 2, 1040);
    const panelHeight = Math.min(height - 48, 720);
    const x = (width - panelWidth) / 2;
    const y = (height - panelHeight) / 2;
    const lineHeight = 22;
    const gutterWidth = 48;
    const fontSize = Math.max(11, Math.min(14, width / 90));
    const colorsByName = Object.fromEntries(Object.entries(colors).map(([name, key]) => [name, state.tokens[key]]));

    ctx.globalAlpha = 0.09;
    ctx.fillStyle = state.tokens["--scene-editor"];
    ctx.strokeStyle = state.tokens["--scene-border"];
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, panelWidth, panelHeight, 6); ctx.fill(); ctx.globalAlpha = 0.22; ctx.stroke(); }
    else { ctx.fillRect(x, y, panelWidth, panelHeight); ctx.globalAlpha = 0.22; ctx.strokeRect(x, y, panelWidth, panelHeight); }
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = state.tokens["--scene-panel"];
    ctx.fillRect(x + 1, y + 1, panelWidth - 2, 32);
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x + 1, y + 33, gutterWidth, panelHeight - 34);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = colorsByName.dim;
    ctx.font = `${fontSize}px ${state.tokens["--scene-title-font"] || "system-ui, sans-serif"}`;
    ctx.fillText("src  /  monitor  /  theme.mjs", x + 16, y + 21);
    ctx.fillText("⋯", x + panelWidth - 36, y + 21);

    const clipTop = y + 34;
    const clipBottom = y + panelHeight - 28;
    const clipLeft = x + gutterWidth + 6;
    const clipRight = x + panelWidth - 6;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
      ctx.clip();

      const visibleRows = Math.max(1, Math.floor((panelHeight - 58) / lineHeight));
      const scroll = staticFrame ? 0 : Math.floor((now - state.startedAt) / 4200) % snippets.length;
      const charsPerSecond = 16 + Math.min(5, state.feed.working) * 9;
      const typed = staticFrame ? Number.POSITIVE_INFINITY : Math.floor((now - state.startedAt) * charsPerSecond / 1000);
      ctx.font = `${fontSize}px ${state.tokens["--scene-mono-font"] || "monospace"}`;
      const caretEnds = [];
      let bracketIndex = 0;
      for (let row = 0; row < visibleRows; row += 1) {
        const lineNumber = row + 1 + scroll;
        const baseline = y + 56 + row * lineHeight;
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = colorsByName.dim;
        ctx.fillText(String(lineNumber).padStart(2, " "), x + 12, baseline);
        const parts = snippets[(row + scroll) % snippets.length];
        const textLength = parts.reduce((length, part) => length + part[1].length, 0);
        let remaining = Math.max(0, Math.min(textLength, typed - row * 4));
        let cursorX = x + gutterWidth + 18;
        for (const [role, part] of parts) {
          const count = Math.min(part.length, remaining);
          remaining -= count;
          if (!count) continue;
          const visiblePart = part.slice(0, count);
          let run = "";
          let runColor = null;
          const flush = () => {
            if (!run) return;
            ctx.globalAlpha = 0.42;
            ctx.fillStyle = colorsByName[runColor] || colorsByName.text;
            ctx.fillText(run, cursorX, baseline);
            cursorX += ctx.measureText(run).width;
            run = "";
          };
          for (const character of visiblePart) {
            const roleForCharacter = role === "bracket" ? ["accent", "cyan", "type"][bracketIndex++ % 3] : role;
            if (run && roleForCharacter !== runColor) flush();
            runColor = roleForCharacter;
            run += character;
          }
          flush();
        }
        caretEnds[row] = { x: cursorX, y: baseline };
      }

      const caretCount = 1 + Math.min(4, state.feed.working);
      const caretBlink = staticFrame || Math.floor(now / 550) % 2 === 0;
      if (caretBlink) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = colorsByName.accent;
        for (let index = 0; index < caretCount; index += 1) {
          const row = (index * 5 + state.caretOffset) % visibleRows;
          const end = caretEnds[row] || { x: x + gutterWidth + 18, y: y + 56 + row * lineHeight };
          ctx.fillRect(end.x, end.y - lineHeight + 3, 2, lineHeight - 3);
        }
      }
      state.caretOffset = staticFrame ? state.caretOffset : Math.floor((now - state.startedAt) / 3600) % visibleRows;

      const miniX = x + panelWidth - 66;
      ctx.globalAlpha = 0.14;
      for (let index = 0; index < Math.min(38, visibleRows * 2); index += 1) {
        ctx.fillStyle = index % 5 === 0 ? colorsByName.keyword : index % 3 === 0 ? colorsByName.function : colorsByName.dim;
        ctx.fillRect(miniX + (index % 3) * 9, y + 46 + index * 7, 20 + (index * 13) % 34, 2);
      }
      const showError = state.feed.errors > 0 || (!staticFrame && Math.floor((now - state.startedAt) / 9000) % 4 === 3);
      if (showError) {
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = colorsByName.error;
        ctx.lineWidth = 1;
        const errorY = y + 56 + Math.min(3, visibleRows - 1) * lineHeight;
        for (let tick = 0; tick < 7; tick += 1) {
          ctx.beginPath(); ctx.moveTo(x + gutterWidth + 26 + tick * 6, errorY + 3 + (tick % 2) * 2);
          ctx.lineTo(x + gutterWidth + 30 + tick * 6, errorY + 1 + (tick % 2) * 2); ctx.stroke();
        }
        ctx.fillStyle = colorsByName.error;
        ctx.font = `${fontSize}px ${state.tokens["--scene-mono-font"] || "monospace"}`;
        ctx.fillText("Error Lens: check pending change  ·  quick fix", x + gutterWidth + 22, errorY + 18);
      }
    } finally {
      ctx.restore();
    }

    ctx.globalAlpha = 0.30;
    ctx.fillStyle = colorsByName.dim;
    ctx.font = `${fontSize}px ${state.tokens["--scene-mono-font"] || "monospace"}`;
    const breadcrumbScroll = staticFrame ? 0 : Math.floor((now - state.startedAt) / 4200) % snippets.length;
    const crumbIndex = staticFrame ? 0 : (breadcrumbScroll + Math.floor((now - state.startedAt) / 7000)) % snippets.length;
    const crumb = snippets[crumbIndex].slice(0, 3).join("");
    ctx.fillText(`src  ›  monitor  ›  ${crumb.slice(0, 28)}`, x + 16, y + panelHeight - 14, panelWidth - 140);
    if (state.savedAt && now - state.savedAt < 900) {
      ctx.globalAlpha = 0.46;
      ctx.fillStyle = colorsByName.string;
      ctx.fillText("✓ Saved", x + panelWidth - 112, y + panelHeight - 14);
    }

    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18, width / 2, height / 2, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, state.tokens["--scene-transparent"]);
    gradient.addColorStop(1, state.tokens["--scene-editor"]);
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return true;
  } finally {
    ctx.restore();
  }
}

function drawSafely(now, staticFrame = false) {
  try {
    const drawn = drawFrame(now, staticFrame);
    if (drawn === true) state.drawFailureReported = false;
    return drawn;
  } catch (error) {
    if (!state.drawFailureReported) {
      state.drawFailureReported = true;
      if (globalThis.console && typeof globalThis.console.error === "function") {
        globalThis.console.error("VSCode ghost background draw failed; retrying on the next frame.", error);
      }
    }
    return false;
  }
}

function drawStaticFrame(force = false) {
  if (!state.running || !state.reduced || state.hidden) return;
  if (!force && state.staticDrawn && !state.staticDirty) return;
  state.staticDrawn = drawSafely(clockNow(), true) === true;
  state.staticDirty = !state.staticDrawn;
}

function schedule() {
  if (!state.running || state.hidden || state.reduced || state.raf !== null) return;
  state.raf = globalThis.requestAnimationFrame(frame);
}

function frame() {
  state.raf = null;
  if (!state.running || state.hidden || state.reduced) return;
  try {
    const now = Math.max(clockNow(), state.lastFrame, state.startedAt);
    if (now - state.lastFrame >= FRAME_INTERVAL) {
      state.lastFrame = now;
      drawSafely(now);
    }
  } finally {
    schedule();
  }
}

function cancelFrame() {
  if (state.raf !== null) globalThis.cancelAnimationFrame(state.raf);
  state.raf = null;
}

function addListener(target, name, handler) {
  target.addEventListener(name, handler);
  state.listeners.push(() => target.removeEventListener(name, handler));
}

function removeListeners() {
  for (const remove of state.listeners.splice(0)) remove();
}

function start(canvas, tokens) {
  stop();
  state.canvas = canvas || null;
  state.context = state.canvas && typeof state.canvas.getContext === "function" ? state.canvas.getContext("2d") : null;
  state.tokens = readSceneTokens();
  state.running = Boolean(state.context && SCENE_COLOR_KEYS.every((key) => state.tokens[key]));
  state.hidden = Boolean(globalThis.document && globalThis.document.hidden);
  state.startedAt = clockNow();
  state.lastFrame = 0;
  state.previousWorking = 0;
  state.savedAt = 0;
  state.feed = { working: 0, total: 0, engines: {}, kinds: {}, errors: 0 };
  state.media = globalThis.matchMedia ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
  state.reduced = Boolean(state.media && state.media.matches);
  state.staticDrawn = false;
  state.staticDirty = false;
  state.drawFailureReported = false;
  if (!state.running) return;

  const visibility = () => {
    state.hidden = Boolean(globalThis.document.hidden);
    if (state.hidden) cancelFrame();
    else if (state.reduced) drawStaticFrame();
    else schedule();
  };
  const resize = () => resizeCanvas();
  addListener(globalThis.document, "visibilitychange", visibility);
  addListener(globalThis, "resize", resize);
  if (state.media && state.media.addEventListener) {
    const motion = (event) => {
      state.reduced = Boolean(event.matches);
      cancelFrame();
      if (state.reduced) {
        state.staticDrawn = false;
        state.staticDirty = true;
        if (!state.hidden) drawStaticFrame();
      } else {
        state.staticDrawn = false;
        state.staticDirty = false;
        if (!state.hidden) schedule();
      }
    };
    addListener(state.media, "change", motion);
  }
  resizeCanvas();
  if (state.reduced) drawStaticFrame();
  else if (!state.hidden) schedule();
}

function stop() {
  cancelFrame();
  removeListeners();
  state.running = false;
  state.staticDrawn = false;
  state.staticDirty = false;
  state.canvas = null;
  state.context = null;
  state.media = null;
}

function resize() {
  resizeCanvas();
}

function update(feed = {}) {
  const working = Math.max(0, Number(feed.working) || 0);
  if (state.previousWorking > 0 && working === 0) state.savedAt = clockNow();
  state.previousWorking = working;
  state.feed = {
    working, total: Math.max(0, Number(feed.total) || 0),
    engines: feed.engines || {}, kinds: feed.kinds || {}, errors: Math.max(0, Number(feed.errors) || 0)
  };
  schedule();
}

export default { start, stop, resize, update };
