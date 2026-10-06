// Live viewer for the typed steps served by GET /api/steps.
//
// The pure half of this module (tab keys, the 12-tab cap, the typing plan,
// queue catch-up, the built-in highlighter, the per-type block script and the
// part B helpers: ANSI parser, line caps, memory result rows and tool names)
// has no DOM dependency, so `node --test` imports it directly. The DOM half
// lives behind init(), which the page reaches through window.FleetLiveView:
// every worker card with stepsSupported gets a VER/OCULTAR button and, when
// open, a viewer that polls /api/steps every 2 s and replays the steps with a
// simulated typing animation. The viewer registry maps each step type to its
// replay: the part A block script for files and messages, and the dedicated
// terminal, memory and tool cards of part B. Step content comes from agents,
// so it never reaches the DOM as HTML: every value is a text node built with
// textContent.

export const MAX_TABS = 12;
export const QUEUE_LIMIT = 5;
export const TYPING_MAX_MS = 3000;
export const MIN_CHARS_PER_FRAME = 2;
export const FRAME_MS = 1000 / 60;
export const MAX_BLOCKS_PER_TAB = 40;
// Distance from the bottom, in pixels, still counted as "at the end".
const STICK_THRESHOLD_PX = 24;
// Step ids remembered per worker to build the next `since`.
export const MAX_KNOWN_STEPS = 400;
// Characters of a finished reasoning that are typed; the rest stays behind the
// "ver todo" toggle and is revealed instantly.
export const THINKING_MAX_CHARS = 4000;

// The `since` sent to /api/steps: the id just before the first step that is
// still running, so a running step keeps coming back until it finishes (its
// content usually arrives only then). With nothing running it is the last id.
export function pollSince(order, steps) {
  const ids = order ?? [];
  const firstRunning = ids.findIndex((id) => steps.get(id)?.status === "running");
  if (firstRunning === -1) return ids.length ? ids[ids.length - 1] : null;
  return firstRunning > 0 ? ids[firstRunning - 1] : null;
}

// A cheap fingerprint: a re-delivered step is replayed only when it changed.
export function stepSignature(step) {
  if (!step) return "";
  let size = 0;
  try {
    size = JSON.stringify(step.data ?? null).length;
  } catch {
    size = -1;
  }
  return `${step.status ?? ""}|${step.truncated ? 1 : 0}|${size}`;
}
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

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (type === "thinking") return "thinking";
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
  if (type === "thinking") return "pensando";
  if (type === "message") return "mensajes";
  return shorten(step?.tool || type, 24);
}

export function stepTabTitle(step) {
  const type = String(step?.type ?? "tool");
  const data = step?.data ?? {};
  if ((type === "write" || type === "edit" || type === "read") && step?.path) return String(step.path);
  if (type === "command") return String(data.command ?? step?.title ?? "");
  if (type === "memory") return String(data.title || data.query || step?.title || "");
  if (type === "thinking") return "razonamiento del modelo";
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

// "m:ss" for an elapsed time in ms; minutes are never capped ("61:00").
export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Splits reasoning text into the part the viewer types and the part the "ver
// todo" toggle reveals instantly; text within the cap stays whole.
export function splitThinkingText(text, max = THINKING_MAX_CHARS) {
  const source = String(text ?? "");
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  if (source.length <= limit) return { visible: source, hidden: "" };
  return { visible: source.slice(0, limit), hidden: source.slice(limit) };
}

// ---------------------------------------------------------------------------
// Mini-terminal helpers (part B): ANSI parsing, line caps and card data
// ---------------------------------------------------------------------------

export const MAX_TERMINAL_LINES = 400;
export const MAX_TOOL_LINES = 200;

// The 16 classic ANSI colours in RGB, used only to pick the nearest theme slot
// for a 256-colour code. The paint always comes from --ansi-N.
const ANSI_16_RGB = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255]
];

// Maps a 256-colour index to the nearest of the 16 theme slots. 0..15 map to
// themselves; 16..231 are the 6x6x6 cube and 232..255 the grey ramp.
export function ansi256To16(index) {
  const value = Math.trunc(Number(index));
  if (!Number.isFinite(value) || value < 0 || value > 255) return null;
  if (value < 16) return value;
  let rgb;
  if (value < 232) {
    const rest = value - 16;
    const level = (channel) => (channel === 0 ? 0 : 55 + channel * 40);
    rgb = [level(Math.floor(rest / 36)), level(Math.floor((rest % 36) / 6)), level(rest % 6)];
  } else {
    const grey = 8 + (value - 232) * 10;
    rgb = [grey, grey, grey];
  }
  let best = 0;
  let bestDistance = Infinity;
  for (let slot = 0; slot < ANSI_16_RGB.length; slot += 1) {
    const [red, green, blue] = ANSI_16_RGB[slot];
    const distance = (red - rgb[0]) ** 2 + (green - rgb[1]) ** 2 + (blue - rgb[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
}

function sgrState() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
}

// Applies one SGR parameter list to the running style state. Unknown codes are
// ignored; `38;5;n` / `48;5;n` map to a slot of the 16-colour palette and
// `38;2;r;g;b` (truecolor) is consumed but not painted.
function applySgr(params, state) {
  const codes = params === "" ? [0] : params.split(";").map((piece) => (piece === "" ? 0 : Number(piece)));
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (!Number.isFinite(code)) continue;
    if (code === 0) Object.assign(state, sgrState());
    else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code >= 30 && code <= 37) state.fg = code - 30;
    else if (code >= 90 && code <= 97) state.fg = code - 90 + 8;
    else if (code === 39) state.fg = null;
    else if (code >= 40 && code <= 47) state.bg = code - 40;
    else if (code >= 100 && code <= 107) state.bg = code - 100 + 8;
    else if (code === 49) state.bg = null;
    else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      if (mode === 5) {
        const slot = ansi256To16(codes[index + 2]);
        if (code === 38) state.fg = slot;
        else state.bg = slot;
        index += 2;
      } else if (mode === 2) {
        index += 4;
      }
    }
  }
}

// Pure SGR ANSI parser: each segment is { text, fg, bg, bold, dim, italic,
// underline } with fg/bg a --ansi-N slot (0..15) or null. Non-SGR escape
// sequences (cursor moves, erases, OSC titles) are stripped, never shown, and
// adjacent segments with the same style are merged.
export function parseAnsi(text) {
  const source = String(text ?? "");
  const segments = [];
  const state = sgrState();
  const push = (value) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.fg === state.fg &&
      last.bg === state.bg &&
      last.bold === state.bold &&
      last.dim === state.dim &&
      last.italic === state.italic &&
      last.underline === state.underline
    ) {
      last.text += value;
      return;
    }
    segments.push({ text: value, fg: state.fg, bg: state.bg, bold: state.bold, dim: state.dim, italic: state.italic, underline: state.underline });
  };
  let index = 0;
  while (index < source.length) {
    if (source[index] !== "\u001b") {
      const escapeAt = source.indexOf("\u001b", index);
      const end = escapeAt < 0 ? source.length : escapeAt;
      push(source.slice(index, end));
      index = end;
      continue;
    }
    const kind = source[index + 1];
    if (kind === "[") {
      let cursor = index + 2;
      while (cursor < source.length && (source.charCodeAt(cursor) < 0x40 || source.charCodeAt(cursor) > 0x7e)) cursor += 1;
      if (cursor >= source.length) break;
      if (source[cursor] === "m") applySgr(source.slice(index + 2, cursor), state);
      index = cursor + 1;
      continue;
    }
    if (kind === "]") {
      let cursor = index + 2;
      while (cursor < source.length) {
        if (source[cursor] === "\u0007") {
          cursor += 1;
          break;
        }
        if (source[cursor] === "\u001b" && source[cursor + 1] === "\\") {
          cursor += 2;
          break;
        }
        cursor += 1;
      }
      index = cursor;
      continue;
    }
    index += kind === undefined ? 1 : 2;
  }
  return segments;
}

// Splits parsed segments into visual lines, keeping the style of each piece.
export function ansiLines(text) {
  const lines = [[]];
  for (const segment of parseAnsi(text)) {
    const pieces = segment.text.split("\n");
    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0) lines.push([]);
      if (pieces[index]) lines[lines.length - 1].push({ ...segment, text: pieces[index] });
    }
  }
  return lines;
}

// Keeps at most `max` lines; `hidden` tells the viewer how many fell off the
// top so it can show the "… N líneas anteriores" note.
export function capTerminalLines(text, max = MAX_TERMINAL_LINES) {
  const limit = Math.max(1, Math.floor(Number(max) || MAX_TERMINAL_LINES));
  const lines = String(text ?? "").split(/\r?\n/);
  if (lines.length <= limit) return { text: lines.join("\n"), hidden: 0 };
  return { text: lines.slice(-limit).join("\n"), hidden: lines.length - limit };
}

// Engram results reach the card as raw tool output, often a JSON string. Finds
// the first list of items with a title among the common shapes (top-level
// array, `results`, `observations`, `items`); null means "show raw text".
const MEMORY_LIST_KEYS = ["results", "observations", "items"];

export function memoryResultRows(results) {
  let value = results;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  let list = Array.isArray(value) ? value : null;
  if (!list) {
    for (const key of MEMORY_LIST_KEYS) {
      if (Array.isArray(value[key])) {
        list = value[key];
        break;
      }
    }
  }
  if (!list) return null;
  const rows = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) continue;
    rows.push({ title, type: item.type ?? item.memoryType ?? null, id: item.id ?? null });
  }
  return rows.length ? rows : null;
}

// "mcp__engram__mem_save" -> server "engram", name "mem_save"; a plain tool
// name keeps no server chip.
export function splitToolName(tool) {
  const full = String(tool ?? "");
  if (!full.startsWith("mcp__")) return { server: null, name: full };
  const rest = full.slice(5);
  const separator = rest.indexOf("__");
  if (separator < 0) return { server: null, name: rest };
  return { server: rest.slice(0, separator), name: rest.slice(separator + 2) };
}

// Splits memory text into plain and **label** pieces so the card can paint the
// markdown-style labels in the accent token without a markdown library.
export function memoryProse(text) {
  const source = String(text ?? "");
  const parts = [];
  const regex = /\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index), label: false });
    parts.push({ text: match[1], label: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last), label: false });
  return parts;
}

// Viewer registry: each step type names the replay the DOM half must build.
// `blocks` is the part A script (files and messages), the dedicated terminal,
// memory, tool and thinking cards are part B, and unknown types fall back to
// blocks.
export const VIEWERS = {
  write: "blocks",
  edit: "blocks",
  read: "blocks",
  message: "blocks",
  command: "terminal",
  memory: "memory",
  tool: "tool",
  thinking: "thinking",
  generic: "blocks"
};

export function viewerFor(step) {
  return VIEWERS[String(step?.type ?? "generic")] ?? VIEWERS.generic;
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
// to test. It still serves files, messages and the generic fallback; command,
// memory and tool types use their dedicated viewers declared in VIEWERS.
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

  // Viewers start open; only an explicit OCULTAR, remembered per worker,
  // keeps one closed.
  function storedOpen(state) {
    try {
      return win.localStorage.getItem(storageKey(state)) !== "0";
    } catch {
      return true;
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
      order: [],
      thinkTimers: new Set(),
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
    state.savedScrollTop = 0;
    body.addEventListener("scroll", () => {
      if (!body.isConnected || state.restoringScroll) return;
      state.savedScrollTop = body.scrollTop;
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
    const since = pollSince(state.order, state.steps);
    if (since) params.set("since", since);
    try {
      const response = await fetchFn(`/api/steps?${params.toString()}`);
      if (!response.ok) return;
      const body = await response.json();
      const steps = Array.isArray(body.steps) ? body.steps : [];
      if (!steps.length && body.notice) showNotice(state, body.notice);
      for (const step of steps) {
        if (!step || !step.id) continue;
        const known = state.steps.get(step.id);
        // Running steps are asked for again on every poll; replay them only
        // when they changed (for example when they finished with content).
        if (known && stepSignature(known) === stepSignature(step)) continue;
        if (!known) {
          state.order.push(step.id);
          if (state.order.length > MAX_KNOWN_STEPS) {
            const dropped = state.order.splice(0, state.order.length - MAX_KNOWN_STEPS);
            for (const id of dropped) state.steps.delete(id);
          }
        }
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
    const viewer = viewerFor(step);
    if (viewer !== "blocks") {
      const item =
        viewer === "terminal"
          ? buildTerminalViewer(state, step)
          : viewer === "memory"
            ? buildMemoryViewer(state, step)
            : viewer === "thinking"
              ? buildThinkingViewer(state, step)
              : buildToolViewer(state, step);
      wrap.appendChild(item.el);
      playItems(state, [item], instant, done);
      return;
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

  // attach() runs while the page re-renders the cards, before the new card is
  // in the document, where setting scrollTop has no effect. A microtask runs
  // right after that synchronous render (and before paint), when the card is
  // already inserted. Scroll events are ignored meanwhile so the reset cannot
  // turn following off. No requestAnimationFrame here: it does not run while
  // the tab is hidden, and the positions must survive background refreshes.
  function restoreScroll(state, tabsScroll) {
    if (!state.body) return;
    state.restoringScroll = true;
    const apply = () => {
      if (state.strip) state.strip.scrollTop = tabsScroll;
      if (state.stickBottom) state.body.scrollTop = state.body.scrollHeight;
      else state.body.scrollTop = state.savedScrollTop;
    };
    queueMicrotask(() => {
      apply();
      win.setTimeout(() => {
        // Second pass in case the card was inserted later than the microtask.
        if (state.body.isConnected) apply();
        state.restoringScroll = false;
      }, 0);
    });
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

  // -- part B viewers: mini terminal, memory card and tool card -------------

  // Types `text` into a node frame by frame (same plan as the code sheet) and
  // runs `decorate` with the final node, so a caller can replace the plain
  // typing with styled spans without ever touching innerHTML.
  function typeText(state, node, text, instant, next, decorate) {
    const finish = () => {
      if (decorate) decorate(node, text);
      else node.textContent = text;
      followBottom(state);
      next();
    };
    if (instant || !text.length) {
      finish();
      return;
    }
    const plan = typingPlan(text.length);
    let index = 0;
    const frame = () => {
      if (state.skipCurrent) {
        finish();
        return;
      }
      index = Math.min(text.length, index + plan.charsPerFrame);
      node.textContent = text.slice(0, index);
      if (index >= text.length) {
        finish();
        return;
      }
      followBottom(state);
      state.rafId = win.requestAnimationFrame(frame);
    };
    state.rafId = win.requestAnimationFrame(frame);
  }

  function runTasks(state, tasks, instant, next) {
    let index = 0;
    const step = () => {
      if (index >= tasks.length) {
        next();
        return;
      }
      const task = tasks[index];
      index += 1;
      task(instant, step);
    };
    step();
  }

  function ansiSpan(segment) {
    const span = el(doc, "span", "term-seg", segment.text);
    if (segment.fg !== null && segment.fg !== undefined) span.style.color = `var(--ansi-${segment.fg})`;
    if (segment.bg !== null && segment.bg !== undefined) span.style.background = `var(--ansi-${segment.bg})`;
    if (segment.bold) span.classList.add("term-bold");
    if (segment.dim) span.classList.add("term-dim");
    if (segment.italic) span.classList.add("term-italic");
    if (segment.underline) span.classList.add("term-underline");
    return span;
  }

  // A dark console panel: the prompt and the command are typed, the output
  // appears line by line (fast, bounded by the typing plan) and a final status
  // line reports the exit code, or a blinking cursor while still running.
  function buildTerminalViewer(state, step) {
    const data = step?.data ?? {};
    const box = el(doc, "div", "live-terminal");
    const body = el(doc, "div", "term-body");
    const commandLine = el(doc, "div", "term-line");
    commandLine.appendChild(el(doc, "span", "term-prompt", "$ "));
    const commandText = el(doc, "span", "term-cmd");
    commandLine.appendChild(commandText);
    body.appendChild(commandLine);
    const output = el(doc, "div", "term-output");
    body.appendChild(output);
    box.appendChild(body);
    if (step?.truncated) box.appendChild(el(doc, "div", "live-notice", "contenido recortado"));
    return {
      el: box,
      play: (instant, done) => {
        typeText(state, commandText, String(data.command ?? ""), instant, () => {
          playTerminalOutput(state, output, step, instant, done);
        });
      }
    };
  }

  function playTerminalOutput(state, output, step, instant, done) {
    const data = step?.data ?? {};
    const capped = capTerminalLines(data.output ?? "");
    const lines = ansiLines(capped.text);
    const rawLines = lines.map((line) => line.map((segment) => segment.text).join(""));
    if (capped.hidden > 0) {
      output.appendChild(el(doc, "div", "term-note", `… ${capped.hidden} líneas anteriores`));
    }
    const nodes = [];
    const ensureLine = (index) => {
      if (!nodes[index]) {
        nodes[index] = el(doc, "div", "term-line");
        output.appendChild(nodes[index]);
      }
      return nodes[index];
    };
    const paintLine = (index) => {
      nodes[index].replaceChildren(...lines[index].map((segment) => ansiSpan(segment)));
    };
    const paintAll = () => {
      for (let index = 0; index < lines.length; index += 1) {
        ensureLine(index);
        paintLine(index);
      }
      finishTerminal(output, step);
      done();
    };
    const totalChars = rawLines.reduce((sum, line) => sum + line.length + 1, 0);
    if (instant || totalChars === 0) {
      paintAll();
      return;
    }
    const plan = typingPlan(totalChars, { maxMs: 1500 });
    let lineIndex = 0;
    let charIndex = 0;
    const frame = () => {
      if (state.skipCurrent) {
        paintAll();
        return;
      }
      let budget = plan.charsPerFrame;
      while (budget > 0 && lineIndex < rawLines.length) {
        const raw = rawLines[lineIndex];
        const node = ensureLine(lineIndex);
        if (charIndex < raw.length) {
          const advance = Math.min(budget, raw.length - charIndex);
          charIndex += advance;
          budget -= advance;
          node.textContent = raw.slice(0, charIndex);
        }
        if (charIndex >= raw.length) {
          paintLine(lineIndex);
          lineIndex += 1;
          charIndex = 0;
          budget -= 1;
        }
      }
      if (lineIndex >= rawLines.length) {
        finishTerminal(output, step);
        followBottom(state);
        done();
        return;
      }
      followBottom(state);
      state.rafId = win.requestAnimationFrame(frame);
    };
    state.rafId = win.requestAnimationFrame(frame);
  }

  function finishTerminal(output, step) {
    const data = step?.data ?? {};
    if (String(step?.status ?? "done") === "running") {
      const line = el(doc, "div", "term-line");
      line.appendChild(el(doc, "span", "term-cursor"));
      output.appendChild(line);
      return;
    }
    const raw = data.exitCode;
    const parsed = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    const code = Number.isFinite(parsed) ? parsed : null;
    const kind = code === null ? "unknown" : code === 0 ? "done" : "error";
    output.appendChild(el(doc, "div", `term-line term-status term-exit-${kind}`, code === null ? "exit ?" : `exit ${code}`));
  }

  // ENGRAM card: an animated memory icon plus the write shape (chips, title
  // and content typed, markdown labels in the accent token) or the read shape
  // (query typed, result rows when the JSON carries titles, raw text if not).
  function buildMemoryViewer(state, step) {
    const data = step?.data ?? {};
    const action = String(data.action ?? "unknown");
    const failed = String(step?.status ?? "") === "error";
    const box = el(doc, "div", `live-memory${failed ? " mem-error" : ""}`);
    const head = el(doc, "div", "mem-head");
    head.appendChild(el(doc, "span", "mem-icon"));
    head.appendChild(el(doc, "span", "mem-action", `ENGRAM · ${action}`));
    box.appendChild(head);
    if (step?.truncated) box.appendChild(el(doc, "div", "live-notice", "contenido recortado"));
    const card = el(doc, "div", "mem-card");
    box.appendChild(card);

    if (failed) {
      const errorText = textOf(data.results) || String(data.title ?? data.query ?? "error");
      const error = el(doc, "div", "mem-error-text");
      card.appendChild(error);
      return { el: box, play: (instant, next) => typeText(state, error, errorText, instant, next) };
    }

    const tasks = [];
    const write = ["save", "update", "session_summary"].includes(action);
    if (write) {
      if (data.memoryType) {
        const chips = el(doc, "div", "mem-chips");
        chips.appendChild(el(doc, "span", "mem-chip", String(data.memoryType)));
        card.appendChild(chips);
      }
      if (data.title) {
        const title = el(doc, "div", "mem-title-text");
        card.appendChild(title);
        tasks.push((instant, next) => typeText(state, title, String(data.title), instant, next));
      }
      if (data.content) {
        const pre = el(doc, "pre", "mem-pre");
        card.appendChild(pre);
        tasks.push((instant, next) =>
          typeText(state, pre, String(data.content), instant, next, (node, text) => {
            node.replaceChildren(
              ...memoryProse(text).map((part) => (part.label ? el(doc, "span", "mem-label", part.text) : doc.createTextNode(part.text)))
            );
          })
        );
      }
    } else {
      if (data.query) {
        const query = el(doc, "div", "mem-query");
        query.appendChild(el(doc, "span", "mem-query-label", "consulta: "));
        const queryText = el(doc, "span", "mem-query-text");
        query.appendChild(queryText);
        card.appendChild(query);
        tasks.push((instant, next) => typeText(state, queryText, String(data.query), instant, next));
      }
      const rows = memoryResultRows(data.results);
      if (rows) {
        const list = el(doc, "div", "mem-rows");
        card.appendChild(list);
        const items = rows.map((row) => {
          const line = el(doc, "div", "mem-row");
          const title = el(doc, "span", "mem-row-title");
          line.appendChild(title);
          const meta = [row.type, row.id === null || row.id === undefined ? null : `#${row.id}`].filter(Boolean).join(" · ");
          if (meta) line.appendChild(el(doc, "span", "mem-row-chip", meta));
          list.appendChild(line);
          return { title, text: row.title };
        });
        tasks.push((instant, next) => playMemoryRows(state, items, instant, next));
      } else {
        const raw = textOf(data.results);
        if (raw) {
          const pre = el(doc, "pre", "mem-pre");
          card.appendChild(pre);
          tasks.push((instant, next) => typeText(state, pre, raw, instant, next));
        }
      }
    }
    return { el: box, play: (instant, next) => runTasks(state, tasks, instant, next) };
  }

  function playMemoryRows(state, rows, instant, next) {
    const finish = () => {
      for (const row of rows) row.title.textContent = row.text;
      next();
    };
    if (instant) {
      finish();
      return;
    }
    const total = rows.reduce((sum, row) => sum + row.text.length, 0);
    const plan = typingPlan(total, { maxMs: 1500 });
    let rowIndex = 0;
    let charIndex = 0;
    const frame = () => {
      if (state.skipCurrent) {
        finish();
        return;
      }
      let budget = plan.charsPerFrame;
      while (budget > 0 && rowIndex < rows.length) {
        const row = rows[rowIndex];
        if (charIndex < row.text.length) {
          const advance = Math.min(budget, row.text.length - charIndex);
          charIndex += advance;
          budget -= advance;
          row.title.textContent = row.text.slice(0, charIndex);
        }
        if (charIndex >= row.text.length) {
          rowIndex += 1;
          charIndex = 0;
          budget -= 1;
        }
      }
      if (rowIndex >= rows.length) {
        finish();
        return;
      }
      followBottom(state);
      state.rafId = win.requestAnimationFrame(frame);
    };
    state.rafId = win.requestAnimationFrame(frame);
  }

  // -- thinking viewer: brain circuit, live counter and typed reasoning -----

  const SVG_NS = "http://www.w3.org/2000/svg";
  const THINK_NODES = [[3, 11], [11, 5], [11, 17], [19, 11], [27, 5], [27, 17], [35, 11]];
  const THINK_LINKS = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6]];

  function svgEl(tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }

  // The icon is pure DOM/SVG (never innerHTML): linked nodes plus, while the
  // model reasons, one pulse per line whose CSS animation travels along it.
  // Every colour comes from the state and glow tokens; the global
  // reduced-motion rule freezes the pulses without touching the counter.
  function buildThinkingIcon(running) {
    const icon = svgEl("svg", {
      viewBox: "0 0 38 22",
      class: `think-icon ${running ? "think-running" : "think-done"}`,
      "aria-hidden": "true"
    });
    THINK_LINKS.forEach(([from, to], index) => {
      const geometry = {
        x1: THINK_NODES[from][0],
        y1: THINK_NODES[from][1],
        x2: THINK_NODES[to][0],
        y2: THINK_NODES[to][1]
      };
      icon.appendChild(svgEl("line", { ...geometry, class: "think-link" }));
      if (running) {
        const pulse = svgEl("line", { ...geometry, class: "think-pulse" });
        pulse.style.animationDelay = `${(index % 4) * 0.45}s`;
        icon.appendChild(pulse);
      }
    });
    for (const [cx, cy] of THINK_NODES) icon.appendChild(svgEl("circle", { cx, cy, r: 1.7, class: "think-node" }));
    return icon;
  }

  // One interval per running viewer, ticking the elapsed time every second.
  // It stops as soon as its node leaves the document: the step was replaced by
  // its finished version, or the viewer was destroyed.
  function startThinkingClock(state, node, startedAt) {
    const timer = win.setInterval(() => {
      if (!node.isConnected) {
        win.clearInterval(timer);
        state.thinkTimers.delete(timer);
        return;
      }
      node.textContent = `pensando ${formatElapsed(Date.now() - startedAt)}`;
    }, 1000);
    state.thinkTimers.add(timer);
  }

  // Thinking card: running shows the animated icon and "pensando m:ss"; done
  // swaps it for a static icon, adds "pensó m:ss" when timing is known and
  // types the reasoning. Beyond THINKING_MAX_CHARS only the head is typed and
  // the "ver todo" toggle reveals the rest instantly.
  function buildThinkingViewer(state, step) {
    const data = step?.data ?? {};
    const running = String(step?.status ?? "done") === "running";
    const text = String(data.text ?? "");
    const startedAt = finiteOrNull(data.startedAt);
    const endedAt = finiteOrNull(data.endedAt);
    const box = el(doc, "div", "live-thinking");
    const head = el(doc, "div", "think-head");
    head.appendChild(buildThinkingIcon(running));
    const status = el(doc, "span", "think-status");
    head.appendChild(status);
    box.appendChild(head);
    if (step?.truncated) box.appendChild(el(doc, "div", "live-notice", "contenido recortado"));
    if (running) {
      const from = startedAt ?? Date.now();
      status.textContent = `pensando ${formatElapsed(Date.now() - from)}`;
      startThinkingClock(state, status, from);
    } else if (startedAt !== null && endedAt !== null && endedAt >= startedAt) {
      status.textContent = `pensó ${formatElapsed(endedAt - startedAt)}`;
    }
    const { visible, hidden } = splitThinkingText(text);
    const tasks = [];
    if (visible) {
      const pre = el(doc, "pre", "live-pre live-text think-text");
      box.appendChild(pre);
      tasks.push((instant, next) =>
        typeText(state, pre, visible, instant, () => {
          if (hidden) {
            const more = el(doc, "button", "think-more", "ver todo");
            more.type = "button";
            more.addEventListener("click", () => {
              pre.textContent = text;
              more.remove();
              followBottom(state);
            });
            box.appendChild(more);
          }
          next();
        })
      );
    }
    return { el: box, play: (instant, next) => runTasks(state, tasks, instant, next) };
  }

  // Pretty-prints a JSON value with the keys in the accent token, using text
  // nodes and spans only.
  function renderJsonInto(node, value) {
    const text = textOf(value);
    const fragment = doc.createDocumentFragment();
    text.split("\n").forEach((line, index) => {
      if (index > 0) fragment.appendChild(doc.createTextNode("\n"));
      const match = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:)/.exec(line);
      if (!match) {
        fragment.appendChild(doc.createTextNode(line));
        return;
      }
      fragment.appendChild(doc.createTextNode(match[1]));
      fragment.appendChild(el(doc, "span", "tool-key", match[2]));
      fragment.appendChild(doc.createTextNode(line.slice(match[0].length)));
    });
    node.replaceChildren(fragment);
  }

  // Tool card: server chip plus short name, the params as indented JSON with
  // the keys in the accent token and the result typed (string) or rendered as
  // JSON (object), both capped at MAX_TOOL_LINES visible lines.
  function buildToolViewer(state, step) {
    const data = step?.data ?? {};
    const { server, name } = splitToolName(data.name ?? step?.tool ?? "");
    const box = el(doc, "div", "live-tool");
    const head = el(doc, "div", "tool-head");
    if (server) head.appendChild(el(doc, "span", "tool-server", server));
    head.appendChild(el(doc, "span", "tool-name", name || "herramienta"));
    box.appendChild(head);
    if (step?.truncated) box.appendChild(el(doc, "div", "live-notice", "contenido recortado"));

    const tasks = [];
    const hasParams = data.params !== null && data.params !== undefined && data.params !== "";
    if (hasParams) {
      box.appendChild(el(doc, "div", "live-label", "parámetros"));
      const pre = el(doc, "pre", "live-pre live-code tool-json");
      box.appendChild(pre);
      tasks.push((instant, next) =>
        typeText(state, pre, textOf(data.params), instant, next, (node) => renderJsonInto(node, data.params))
      );
    }
    const result = data.result;
    const running = String(step?.status ?? "done") === "running";
    if (result === null || result === undefined || result === "") {
      if (running) box.appendChild(el(doc, "div", "live-typing", "escribiendo…"));
    } else {
      const capped = capTerminalLines(textOf(result), MAX_TOOL_LINES);
      if (capped.hidden > 0) box.appendChild(el(doc, "div", "term-note", `… ${capped.hidden} líneas anteriores`));
      box.appendChild(el(doc, "div", "live-label", "resultado"));
      const pre = el(doc, "pre", typeof result === "string" ? "live-pre live-text" : "live-pre live-code tool-json");
      box.appendChild(pre);
      tasks.push((instant, next) =>
        typeText(state, pre, capped.text, instant, next, typeof result === "string" ? null : (node) => renderJsonInto(node, result))
      );
    }
    return { el: box, play: (instant, next) => runTasks(state, tasks, instant, next) };
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
    // Moving the panel into the freshly rendered card resets the browser's
    // scroll positions to the top, so put them back where they were.
    const tabsScroll = state.strip ? state.strip.scrollTop : 0;
    card.appendChild(state.panel);
    state.panel.hidden = !state.open;
    restoreScroll(state, tabsScroll);
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
    for (const state of states.values()) {
      stopPoll(state);
      for (const timer of state.thinkTimers) win.clearInterval(timer);
      state.thinkTimers.clear();
    }
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
