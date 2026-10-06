// Live viewer (part A) for the typed steps served by GET /api/steps.
//
// The pure half of this module (tab keys, the 12-tab cap, the typing plan,
// queue catch-up, the built-in highlighter and the per-type block script) has
// no DOM dependency, so `node --test` imports it directly. The DOM half lives
// behind init(), which the page reaches through window.FleetLiveView: every
// worker card with stepsSupported gets a VER/OCULTAR button and, when open, a
// viewer that polls /api/steps every 2 s and replays the steps with a
// simulated typing animation. Step content comes from agents, so it never
// reaches the DOM as HTML: every value is a text node built with textContent.

export const MAX_TABS = 12;
export const QUEUE_LIMIT = 5;
export const TYPING_MAX_MS = 3000;
export const MIN_CHARS_PER_FRAME = 2;
export const FRAME_MS = 1000 / 60;
export const MAX_BLOCKS_PER_TAB = 40;
// Distance from the bottom, in pixels, still counted as "at the end".
const STICK_THRESHOLD_PX = 24;
const STORAGE_PREFIX = "fleet-monitor.live.";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function textOf(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function shorten(value, max = 60) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function basename(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

// Windows paths are case-insensitive and reach the page with mixed slashes
// (OpenCode uses \\, Claude Code tool inputs sometimes use /), so the tab key
// normalizes both.
export function normalizePath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// A tab is keyed by what the step touches: files by path (every write/edit/
// read of the same file shares a tab), commands and memory calls and other
// tools one tab each, and every message shares the "mensajes" tab.
export function stepTabKey(step) {
  const type = String(step?.type ?? "tool");
  if (type === "write" || type === "edit" || type === "read") {
    const filePath = step?.path;
    return filePath ? `file:${normalizePath(filePath)}` : `step:${String(step?.id ?? "")}`;
  }
  if (type === "command") return `cmd:${String(step?.id ?? "")}`;
  if (type === "memory") return `mem:${String(step?.id ?? "")}`;
  if (type === "message") return "messages";
  return `tool:${String(step?.id ?? "")}`;
}

export function stepTabLabel(step) {
  const type = String(step?.type ?? "tool");
  const data = step?.data ?? {};
  if ((type === "write" || type === "edit" || type === "read") && step?.path) {
    return basename(step.path);
  }
  if (type === "command") return `$ ${shorten(data.command ?? step?.title ?? "comando", 36)}`;
  if (type === "memory") {
    const hint = data.title || data.query || data.action || "memoria";
    return `mem: ${shorten(hint, 36)}`;
  }
  if (type === "message") return "mensajes";
  return shorten(step?.tool || type, 24);
}

export function stepTabTitle(step) {
  const type = String(step?.type ?? "tool");
  const data = step?.data ?? {};
  if ((type === "write" || type === "edit" || type === "read") && step?.path) return String(step.path);
  if (type === "command") return String(data.command ?? step?.title ?? "");
  if (type === "memory") return String(data.title || data.query || step?.title || "");
  return String(step?.title ?? step?.tool ?? type);
}

// Replaces or appends the tab of a step and keeps the strip at MAX_TABS by
// dropping the oldest tab that is not the active one.
export function upsertTab(tabs, step, activeKey) {
  const key = stepTabKey(step);
  const next = (tabs ?? []).slice();
  const tab = {
    key,
    label: stepTabLabel(step),
    title: stepTabTitle(step),
    status: String(step?.status ?? "done")
  };
  const index = next.findIndex((entry) => entry.key === key);
  if (index >= 0) next[index] = { ...next[index], ...tab };
  else next.push(tab);
  while (next.length > MAX_TABS) {
    let drop = next.findIndex((entry) => entry.key !== activeKey && entry.key !== key);
    if (drop < 0) drop = 0;
    next.splice(drop, 1);
  }
  return next;
}

// One step lasts at most ~3 s however long its text is, and no slower than
// MIN_CHARS_PER_FRAME characters per frame.
export function typingPlan(length, options = {}) {
  const chars = Math.max(0, Math.ceil(Number(length) || 0));
  const maxMs = Number(options.maxMs) || TYPING_MAX_MS;
  const frameMs = Number(options.frameMs) || FRAME_MS;
  const minChars = Number(options.minChars) || MIN_CHARS_PER_FRAME;
  const maxFrames = Math.max(1, Math.round(maxMs / frameMs));
  const charsPerFrame = Math.max(minChars, Math.ceil(chars / maxFrames));
  const frames = chars === 0 ? 0 : Math.ceil(chars / charsPerFrame);
  return { charsPerFrame, frames, durationMs: Math.round(frames * frameMs) };
}

// More than QUEUE_LIMIT steps waiting: the older ones finish instantly so the
// viewer catches up with the agent.
export function catchUpCount(queued, limit = QUEUE_LIMIT) {
  return Math.max(0, Math.floor(Number(queued) || 0) - limit);
}

// ---------------------------------------------------------------------------
// Built-in highlighter (no library, no download)
// ---------------------------------------------------------------------------

const JS_KEYWORDS =
  "async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield|readonly|public|private|protected";
const PY_KEYWORDS =
  "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield";
const PS_KEYWORDS =
  "begin|break|catch|class|continue|data|do|dynamicparam|else|elseif|end|enum|exit|filter|finally|for|foreach|from|function|if|in|param|process|return|switch|throw|trap|try|until|using|while|true|false|null";
const SH_KEYWORDS =
  "case|do|done|elif|else|esac|fi|for|function|if|in|local|return|then|until|while|export|readonly|shift|source|true|false";

// Rules are tried at the current position (sticky regex) in order; the first
// hit wins, so comments and strings must come before keywords and numbers.
const RULES = {
  js: [
    { kind: "comment", re: /\/\/[^\n]*/y },
    { kind: "comment", re: /\/\*[\s\S]*?(?:\*\/|$)/y },
    { kind: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
    { kind: "string", re: /'(?:[^'\\\n]|\\.)*'?/y },
    { kind: "string", re: /`(?:[^`\\]|\\.)*`?/y },
    { kind: "number", re: /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y },
    { kind: "keyword", re: new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, "y") },
    { kind: "function", re: /[A-Za-z_$][\w$]*(?=\s*\()/y }
  ],
  json: [
    { kind: "comment", re: /\/\/[^\n]*/y },
    { kind: "string", re: /"(?:[^"\\]|\\.)*"/y },
    { kind: "number", re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { kind: "keyword", re: /\b(?:true|false|null)\b/y }
  ],
  css: [
    { kind: "comment", re: /\/\*[\s\S]*?(?:\*\/|$)/y },
    { kind: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
    { kind: "string", re: /'(?:[^'\\\n]|\\.)*'?/y },
    { kind: "number", re: /#[0-9a-fA-F]{3,8}\b/y },
    { kind: "number", re: /-?\d+(?:\.\d+)?(?:%|[a-z]{1,4})?\b/y },
    { kind: "keyword", re: /!important\b/y },
    { kind: "keyword", re: /@[a-z-]+/y },
    { kind: "function", re: /[a-z-]+(?=\s*\()/y }
  ],
  html: [
    { kind: "comment", re: /<!--[\s\S]*?(?:-->|$)/y },
    { kind: "string", re: /"[^"]*"?/y },
    { kind: "string", re: /'[^']*'?/y },
    { kind: "keyword", re: /<\/?[a-zA-Z][\w-]*/y },
    { kind: "keyword", re: /\/?>/y }
  ],
  markdown: [
    { kind: "string", re: /```[\s\S]*?(?:```|$)/y },
    { kind: "keyword", re: /^#{1,6}[^\n]*/my },
    { kind: "string", re: /`[^`\n]*`/y },
    { kind: "keyword", re: /\*\*[^*\n]+\*\*/y },
    { kind: "keyword", re: /^\s*[-*+]\s/my }
  ],
  powershell: [
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /"(?:[^"`]|`.)*"?/y },
    { kind: "string", re: /'[^']*'?/y },
    { kind: "number", re: /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/y },
    { kind: "function", re: /\b[A-Z][a-zA-Z]*-[A-Z][a-zA-Z]*\b/y },
    { kind: "keyword", re: new RegExp(`\\b(?:${PS_KEYWORDS})\\b`, "y") },
    { kind: "keyword", re: /\$[A-Za-z_][\w:]*/y }
  ],
  python: [
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /"""[\s\S]*?(?:"""|$)/y },
    { kind: "string", re: /'''[\s\S]*?(?:'''|$)/y },
    { kind: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
    { kind: "string", re: /'(?:[^'\\\n]|\\.)*'?/y },
    { kind: "number", re: /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/y },
    { kind: "keyword", re: new RegExp(`\\b(?:${PY_KEYWORDS})\\b`, "y") },
    { kind: "function", re: /[A-Za-z_]\w*(?=\s*\()/y }
  ],
  shell: [
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /"(?:[^"\\]|\\.)*"?/y },
    { kind: "string", re: /'[^']*'?/y },
    { kind: "number", re: /\b\d+\b/y },
    { kind: "keyword", re: new RegExp(`\\b(?:${SH_KEYWORDS})\\b`, "y") },
    { kind: "keyword", re: /\$(?:\w+|\{[^}]*\})/y },
    { kind: "function", re: /[A-Za-z_]\w*(?=\s*\(\s*\))/y }
  ]
};

const EXTENSION_LANGUAGES = {
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "js",
  ts: "js",
  tsx: "js",
  mts: "js",
  cts: "js",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  svelte: "html",
  md: "markdown",
  markdown: "markdown",
  ps1: "powershell",
  psm1: "powershell",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell"
};

export function languageForPath(filePath) {
  const name = String(filePath ?? "");
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "plain";
  return EXTENSION_LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "plain";
}

function tokenize(source, rules) {
  const tokens = [];
  let index = 0;
  let plainAt = 0;
  while (index < source.length) {
    let hit = null;
    for (const rule of rules) {
      rule.re.lastIndex = index;
      const match = rule.re.exec(source);
      if (match && match[0].length) {
        hit = { kind: rule.kind, text: match[0] };
        break;
      }
    }
    if (!hit) {
      index += 1;
      continue;
    }
    if (index > plainAt) tokens.push({ text: source.slice(plainAt, index), kind: "plain" });
    tokens.push(hit);
    index += hit.text.length;
    plainAt = index;
  }
  if (plainAt < source.length) tokens.push({ text: source.slice(plainAt), kind: "plain" });
  return tokens;
}

// Returns [{ text, kind }] with kind in plain | comment | string | number |
// keyword | function. Unknown languages return the whole text as one plain
// token; the join of the tokens always equals the input.
export function highlight(text, language) {
  const source = String(text ?? "");
  const rules = RULES[language];
  if (!rules) return [{ text: source, kind: "plain" }];
  return tokenize(source, rules);
}

export function highlightPath(text, filePath) {
  return highlight(text, languageForPath(filePath));
}

// ---------------------------------------------------------------------------
// Per-type replay script
// ---------------------------------------------------------------------------

function pushBlock(blocks, kind, label, value, extra = {}) {
  const text = textOf(value);
  if (!text) return;
  blocks.push({ kind, label, text, ...extra });
}

// Describes what the viewer has to play for a step as an ordered list of
// blocks: { kind, label, text, lang?, path? }. Pure, so the viewers stay easy
// to test and to extend when part B adds the terminal and the memory card.
export function stepBlocks(step) {
  const type = String(step?.type ?? "tool");
  const data = step?.data ?? {};
  const blocks = [];
  if (type === "write") {
    pushBlock(blocks, "code", null, data.content, { lang: languageForPath(step?.path), path: step?.path ?? null });
  } else if (type === "edit") {
    const edits =
      Array.isArray(data.edits) && data.edits.length
        ? data.edits
        : [{ oldText: data.oldText ?? "", newText: data.newText ?? "" }];
    edits.forEach((edit, index) => {
      const suffix = edits.length > 1 ? ` (${index + 1}/${edits.length})` : "";
      pushBlock(blocks, "removed", `antes${suffix}`, edit?.oldText);
      pushBlock(blocks, "added", `después${suffix}`, edit?.newText, { lang: languageForPath(step?.path) });
    });
  } else if (type === "read") {
    pushBlock(blocks, "scan", null, step?.path || step?.title || "leído");
  } else if (type === "message") {
    pushBlock(blocks, "text", null, data.text);
  } else if (type === "command") {
    pushBlock(blocks, "code", "comando", data.command, { lang: "shell" });
    pushBlock(blocks, "code", "salida", data.output);
  } else if (type === "memory") {
    pushBlock(blocks, "text", "acción", data.action);
    pushBlock(blocks, "text", "título", data.title);
    pushBlock(blocks, "code", "contenido", data.content);
    pushBlock(blocks, "code", "consulta", data.query);
    pushBlock(blocks, "code", "resultados", data.results);
  } else {
    pushBlock(blocks, "text", "herramienta", data.name ?? step?.tool);
    pushBlock(blocks, "code", "parámetros", data.params);
    pushBlock(blocks, "code", "resultado", data.result);
  }
  if (step?.truncated) blocks.push({ kind: "notice", text: "contenido recortado" });
  return blocks;
}

// ---------------------------------------------------------------------------
// DOM half
// ---------------------------------------------------------------------------

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function lineNumbers(text) {
  const count = (String(text).match(/\n/g) || []).length + 1;
  let out = "";
  for (let index = 1; index <= count; index += 1) out += `${index}\n`;
  return out.slice(0, -1);
}

export function init(options = {}) {
  const win = options.window ?? (typeof window !== "undefined" ? window : null);
  const doc = options.document ?? (typeof document !== "undefined" ? document : null);
  if (!win || !doc) return null;
  const pollMs = Number(options.pollMs) || 2000;
  const fetchFn = options.fetch ?? ((url) => win.fetch(url, { cache: "no-store" }));
  const prefersReduced = options.reduceMotion ?? (() => {
    try {
      return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });

  const states = new Map();
  const openStates = new Set();

  function storageKey(state) {
    return `${STORAGE_PREFIX}${state.projectId ?? ""}.${state.worker.name ?? ""}`;
  }

  function storedOpen(state) {
    try {
      return win.localStorage.getItem(storageKey(state)) === "1";
    } catch {
      return false;
    }
  }

  function rememberOpen(state) {
    try {
      win.localStorage.setItem(storageKey(state), state.open ? "1" : "0");
    } catch {
      // Without storage the choice lives only in this page.
    }
  }

  function createState(worker, projectId) {
    return {
      worker,
      projectId,
      open: false,
      collapsed: false,
      follow: true,
      activeKey: null,
      tabs: [],
      tabEls: new Map(),
      queue: [],
      steps: new Map(),
      animating: false,
      skipCurrent: false,
      inFlight: false,
      lastId: null,
      notice: null,
      pollTimer: null,
      rafId: null,
      panel: null,
      strip: null,
      tabBox: null,
      body: null,
      content: null,
      toggle: null,
      followBtn: null,
      skipBtn: null,
      collapseBtn: null
    };
  }

  function ensureDom(state) {
    if (state.panel) return;
    const panel = el(doc, "div", "live-viewer");
    const strip = el(doc, "div", "live-tabs");
    const tabBox = el(doc, "div", "live-tab-box");
    const follow = el(doc, "button", "live-follow", "SEGUIR");
    follow.type = "button";
    follow.title = "Volver a seguir al agente paso a paso";
    follow.addEventListener("click", () => {
      state.follow = true;
      renderFollow(state);
      activateLatest(state);
    });
    const skip = el(doc, "button", "live-skip", "SALTAR");
    skip.type = "button";
    skip.title = "Terminar la animación actual";
    skip.addEventListener("click", () => {
      if (state.animating) state.skipCurrent = true;
    });
    const collapse = el(doc, "button", "live-collapse", "▾");
    collapse.type = "button";
    collapse.title = "Plegar el visor";
    collapse.setAttribute("aria-label", "Plegar visor");
    collapse.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      panel.classList.toggle("collapsed", state.collapsed);
      collapse.textContent = state.collapsed ? "▸" : "▾";
    });
    strip.appendChild(tabBox);
    strip.appendChild(follow);
    strip.appendChild(skip);
    strip.appendChild(collapse);
    const body = el(doc, "div", "live-body");
    const content = el(doc, "div", "live-content");
    body.appendChild(content);
    // The body sticks to its bottom while text is typed, like a terminal. If
    // the user scrolls up to read, it stops following until they scroll back
    // to the end.
    state.stickBottom = true;
    body.addEventListener("scroll", () => {
      state.stickBottom = body.scrollHeight - body.scrollTop - body.clientHeight < STICK_THRESHOLD_PX;
    });
    panel.appendChild(strip);
    panel.appendChild(body);
    const toggle = el(doc, "button", "live-toggle", "VER");
    toggle.type = "button";
    toggle.addEventListener("click", () => setOpen(state, !state.open));
    state.panel = panel;
    state.strip = strip;
    state.tabBox = tabBox;
    state.body = body;
    state.content = content;
    state.toggle = toggle;
    state.followBtn = follow;
    state.skipBtn = skip;
    state.collapseBtn = collapse;
    state.open = storedOpen(state);
  }

  function renderFollow(state) {
    state.followBtn.classList.toggle("follow-on", state.follow);
    state.followBtn.setAttribute("aria-pressed", state.follow ? "true" : "false");
  }

  function setOpen(state, open) {
    state.open = open;
    rememberOpen(state);
    state.panel.hidden = !open;
    state.toggle.textContent = open ? "OCULTAR" : "VER";
    state.toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      openStates.add(state);
      startPoll(state);
      pump(state);
    } else {
      openStates.delete(state);
      stopPoll(state);
    }
  }

  // -- polling --------------------------------------------------------------

  function startPoll(state) {
    if (state.pollTimer !== null || state.inFlight || doc.hidden) return;
    poll(state);
    state.pollTimer = win.setInterval(() => {
      if (!doc.hidden) poll(state);
    }, pollMs);
  }

  function stopPoll(state) {
    if (state.pollTimer === null) return;
    win.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function poll(state) {
    if (state.inFlight) return;
    state.inFlight = true;
    const params = new URLSearchParams();
    params.set("project", state.projectId ?? "");
    params.set("worker", state.worker.name ?? "");
    if (state.lastId) params.set("since", state.lastId);
    try {
      const response = await fetchFn(`/api/steps?${params.toString()}`);
      if (!response.ok) return;
      const body = await response.json();
      const steps = Array.isArray(body.steps) ? body.steps : [];
      if (!steps.length && body.notice) showNotice(state, body.notice);
      for (const step of steps) {
        if (!step || !step.id) continue;
        state.lastId = step.id;
        enqueue(state, step);
      }
    } catch {
      // A temporary failure only delays the next poll; keep the timer alive.
    } finally {
      state.inFlight = false;
    }
  }

  function showNotice(state, text) {
    if (state.notice === text) return;
    state.notice = text;
    if (!state.tabs.length) {
      state.content.textContent = "";
      state.content.appendChild(el(doc, "div", "live-notice", text));
    }
  }

  function enqueue(state, step) {
    state.steps.set(step.id, step);
    const index = state.queue.findIndex((queued) => queued.id === step.id);
    if (index >= 0) state.queue[index] = step;
    else state.queue.push(step);
    pump(state);
  }

  // -- replay engine --------------------------------------------------------

  function pump(state) {
    if (state.animating) return;
    if (!state.queue.length) {
      state.skipCurrent = false;
      return;
    }
    if (doc.hidden || !state.open) return;
    const skip = catchUpCount(state.queue.length);
    for (let index = 0; index < skip; index += 1) {
      renderStep(state, state.queue.shift(), true, () => {});
    }
    if (!state.queue.length) return;
    const step = state.queue.shift();
    state.animating = true;
    renderStep(state, step, prefersReduced(), () => {
      state.skipCurrent = false;
      state.animating = false;
      pump(state);
    });
  }

  function ensureTab(state, step) {
    state.tabs = upsertTab(state.tabs, step, state.activeKey);
    const wanted = new Set(state.tabs.map((tab) => tab.key));
    for (const [key, dom] of state.tabEls) {
      if (!wanted.has(key)) {
        dom.button.remove();
        dom.content.remove();
        state.tabEls.delete(key);
      }
    }
    for (const tab of state.tabs) {
      let dom = state.tabEls.get(tab.key);
      if (!dom) {
        const button = el(doc, "button", "live-tab");
        button.type = "button";
        button.addEventListener("click", () => {
          state.follow = false;
          renderFollow(state);
          activateTab(state, tab.key);
        });
        const content = el(doc, "div", "live-tab-content");
        dom = { button, content, blocks: new Map() };
        state.tabEls.set(tab.key, dom);
      }
      dom.button.textContent = tab.label;
      dom.button.title = tab.title;
      dom.button.className = `live-tab status-${tab.status}${tab.key === state.activeKey ? " active" : ""}`;
      state.tabBox.appendChild(dom.button);
    }
    return state.tabs.find((tab) => tab.key === stepTabKey(step)) ?? state.tabs[state.tabs.length - 1];
  }

  function activateTab(state, key) {
    const dom = state.tabEls.get(key);
    if (!dom) return;
    const switched = state.activeKey !== key;
    state.activeKey = key;
    state.content.replaceChildren(dom.content);
    for (const [tabKey, tabDom] of state.tabEls) {
      tabDom.button.classList.toggle("active", tabKey === key);
    }
    // A newly shown tab opens at its latest line and follows it again.
    if (switched) {
      state.stickBottom = true;
      followBottom(state);
    }
  }

  function activateLatest(state) {
    const last = state.tabs[state.tabs.length - 1];
    if (last) activateTab(state, last.key);
  }

  function renderStep(state, step, instant, done) {
    const tab = ensureTab(state, step);
    const tabDom = tab ? state.tabEls.get(tab.key) : null;
    if (!tabDom) {
      done();
      return;
    }
    if (state.follow) activateTab(state, tab.key);
    const wrap = el(doc, "div", `live-step status-${String(step.status ?? "done")}`);
    const previous = tabDom.blocks.get(step.id);
    if (previous && previous.parentNode) previous.replaceWith(wrap);
    else tabDom.content.appendChild(wrap);
    tabDom.blocks.set(step.id, wrap);
    while (tabDom.content.childNodes.length > MAX_BLOCKS_PER_TAB) {
      tabDom.content.removeChild(tabDom.content.firstChild);
    }
    const blocks = stepBlocks(step);
    if (step.status === "running" && !blocks.length) {
      wrap.appendChild(el(doc, "div", "live-typing", "escribiendo…"));
      done();
      return;
    }
    const items = blocks.map((block) => buildBlock(state, block));
    for (const item of items) wrap.appendChild(item.el);
    followBottom(state);
    playItems(state, items, instant, done);
  }

  function followBottom(state) {
    if (state.stickBottom && state.body) state.body.scrollTop = state.body.scrollHeight;
  }

  function playItems(state, items, instant, done) {
    let index = 0;
    const next = () => {
      if (index >= items.length) {
        done();
        return;
      }
      const item = items[index];
      index += 1;
      item.play(instant, next);
    };
    next();
  }

  function buildBlock(state, block) {
    const box = el(doc, "div", `live-block live-block-${block.kind}`);
    if (block.kind === "notice") {
      box.appendChild(el(doc, "div", "live-notice", block.text));
      return { el: box, play: (instant, next) => next() };
    }
    if (block.kind === "scan") {
      box.appendChild(el(doc, "div", "live-scan-line", block.text));
      box.appendChild(el(doc, "div", "live-scan-note", "leído"));
      box.appendChild(el(doc, "div", "live-scan"));
      return { el: box, play: (instant, next) => next() };
    }
    if (block.label) box.appendChild(el(doc, "div", "live-label", block.label));
    const sheet = block.kind === "code" || block.kind === "added";
    const pre = el(doc, "pre", "live-pre");
    if (block.kind === "code") pre.classList.add("live-code");
    if (block.kind === "added") pre.classList.add("added");
    if (block.kind === "removed") pre.classList.add("removed");
    if (block.kind === "text") pre.classList.add("live-text");
    let gutter = null;
    if (sheet) {
      const row = el(doc, "div", "live-sheet");
      gutter = el(doc, "pre", "live-gutter");
      gutter.setAttribute("aria-hidden", "true");
      row.appendChild(gutter);
      row.appendChild(pre);
      box.appendChild(row);
      gutter.textContent = "";
    } else {
      box.appendChild(pre);
    }
    const instantOnly = block.kind === "removed";
    return {
      el: box,
      play: (instant, next) => typeInto(state, pre, gutter, block, instant || instantOnly, next)
    };
  }

  function typeInto(state, pre, gutter, block, instant, next) {
    const text = block.text;
    const finish = () => {
      renderHighlighted(pre, text, block.lang);
      if (gutter) gutter.textContent = lineNumbers(text);
      followBottom(state);
      next();
    };
    if (instant || !text.length) {
      pre.textContent = text;
      finish();
      return;
    }
    const plan = typingPlan(text.length);
    let index = 0;
    const frame = () => {
      if (state.skipCurrent) {
        pre.textContent = text;
        finish();
        return;
      }
      index = Math.min(text.length, index + plan.charsPerFrame);
      pre.textContent = text.slice(0, index);
      if (gutter) gutter.textContent = lineNumbers(text.slice(0, index));
      followBottom(state);
      if (index >= text.length) {
        finish();
        return;
      }
      state.rafId = win.requestAnimationFrame(frame);
    };
    state.rafId = win.requestAnimationFrame(frame);
  }

  // After typing, tokens replace the plain text; each token maps to a
  // --code-* theme token through its class. Only textContent is used, so agent
  // content can never inject markup.
  function renderHighlighted(pre, text, language) {
    const tokens = highlight(text, language);
    if (tokens.length === 1 && tokens[0].kind === "plain") {
      pre.textContent = text;
      return;
    }
    const fragment = doc.createDocumentFragment();
    for (const token of tokens) {
      if (token.kind === "plain") {
        fragment.appendChild(doc.createTextNode(token.text));
      } else {
        const span = el(doc, "span", `tok tok-${token.kind}`, token.text);
        fragment.appendChild(span);
      }
    }
    pre.replaceChildren(fragment);
  }

  // -- attach ---------------------------------------------------------------

  function attach(card, worker, projectId) {
    if (!card || !worker || worker.stepsSupported !== true) return null;
    const key = `${projectId ?? ""}\u0000${worker.name ?? ""}`;
    let state = states.get(key);
    if (!state) {
      state = createState(worker, projectId);
      state.open = storedOpen(state);
      states.set(key, state);
    }
    state.worker = worker;
    state.projectId = projectId;
    ensureDom(state);
    const head = card.querySelector(".worker-head");
    if (head) head.appendChild(state.toggle);
    state.toggle.textContent = state.open ? "OCULTAR" : "VER";
    state.toggle.setAttribute("aria-expanded", state.open ? "true" : "false");
    card.appendChild(state.panel);
    state.panel.hidden = !state.open;
    renderFollow(state);
    if (state.open) {
      openStates.add(state);
      startPoll(state);
      pump(state);
    } else {
      openStates.delete(state);
      stopPoll(state);
    }
    return state;
  }

  function onVisibility() {
    for (const state of openStates) {
      if (doc.hidden) stopPoll(state);
      else {
        startPoll(state);
        pump(state);
      }
    }
  }
  doc.addEventListener("visibilitychange", onVisibility);

  return { attach, states, destroy() {
    doc.removeEventListener("visibilitychange", onVisibility);
    for (const state of states.values()) stopPoll(state);
    states.clear();
    openStates.clear();
  } };
}

// The page loads this module with <script type="module" src="/js/live-view.mjs">
// so the browser calls it after parsing; window.FleetLiveView is ready before
// the first /api/state response can build the worker cards.
if (typeof window !== "undefined" && typeof document !== "undefined" && !window.FleetLiveView) {
  window.FleetLiveView = init();
}
