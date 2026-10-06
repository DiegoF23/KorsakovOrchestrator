// Shared, pure helpers for the typed step stream served by GET /api/steps.
// A step is { id, time, type, tool, status, title, path?, data, truncated? }:
// the adapters keep the complete tool input and output so a future viewer can
// replay it, unlike the one-line events the cards still use. Everything
// textual is capped and binary content is replaced here, so no adapter can
// leak a huge or unreadable payload.
import { shortText } from "./format.mjs";

export const MAX_STEP_TEXT = 200000;
export const MAX_STEPS = 300;
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const BINARY_PLACEHOLDER = "[datos binarios omitidos]";
// C0 controls except tab, newline and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F]/;

function capValue(value, depth, state) {
  if (typeof value === "string") {
    if (CONTROL_CHARS.test(value)) {
      state.truncated = true;
      return BINARY_PLACEHOLDER;
    }
    if (value.length > MAX_STEP_TEXT) {
      state.truncated = true;
      return value.slice(0, MAX_STEP_TEXT);
    }
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    return "[...]";
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) state.truncated = true;
    return value.slice(0, MAX_ITEMS).map((item) => capValue(item, depth + 1, state));
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_ITEMS) state.truncated = true;
  const out = {};
  for (const key of keys.slice(0, MAX_ITEMS)) out[key] = capValue(value[key], depth + 1, state);
  return out;
}

// Caps every text field of a step (title, path and the whole data tree) and
// flags the cut with `truncated: true`.
export function capStep(step) {
  const state = { truncated: false };
  const out = {};
  for (const [key, value] of Object.entries(step)) {
    out[key] = capValue(value, 0, state);
  }
  if (state.truncated) out.truncated = true;
  return out;
}

// Only the last MAX_STEPS of a worker are kept.
export function lastSteps(steps) {
  return (steps ?? []).slice(-MAX_STEPS);
}

// "mcp__plugin_engram_engram__mem_search" -> "search"; null when the tool is
// not an Engram call.
export function memoryAction(tool) {
  const match = /mem_([a-z0-9_]+)$/i.exec(String(tool ?? ""));
  return match ? match[1].toLowerCase() : null;
}

export function memoryStep({ id, time, tool, status, input = {}, output = null }) {
  const action = memoryAction(tool) ?? "unknown";
  const hint = shortText(input.title || input.query || "", 120);
  return capStep({
    id,
    time,
    type: "memory",
    tool,
    status,
    title: hint ? `memoria ${action}: ${hint}` : `memoria ${action}`,
    data: {
      action,
      title: input.title ?? null,
      memoryType: input.type ?? input.memoryType ?? null,
      content: input.content ?? null,
      query: input.query ?? null,
      results: output ?? null
    }
  });
}

export function commandStep({ id, time, tool, status, command, output, exitCode }) {
  return capStep({
    id,
    time,
    type: "command",
    tool,
    status,
    title: `comando: ${shortText(command, 150)}`,
    data: {
      command: command ?? "",
      output: output ?? "",
      exitCode: exitCode ?? null
    }
  });
}

// A generic tool line: the tool name plus the most descriptive string of its
// input, so the card says something useful without dumping every parameter.
export function toolTitle(tool, input = {}) {
  const hint = input.description || input.prompt || input.query || "";
  return hint ? `${tool}: ${shortText(hint, 120)}` : String(tool);
}

export function stepStatus(value) {
  const status = String(value ?? "").toLowerCase();
  if (status === "completed" || status === "done" || status === "success") return "done";
  if (status === "error" || status === "failed") return "error";
  return "running";
}

export function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
