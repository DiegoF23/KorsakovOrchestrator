// Todo-list progress of a worker and the pace derived from it. Everything here
// is pure and unit-tested: the adapters feed raw records (OpenCode messages,
// Claude transcripts, Codex rollout/log entries) through their own extractor
// and then build the shared shape through `buildProgress`. The card shows the
// measured remaining time and the pace chip instead of trusting the etaEnd the
// orchestrator guessed at launch.
import { parseEtaEnd, resolveRemainingText } from "./format.mjs";

// One progress item and the whole card keep short text: the bar is a glance,
// not a document reader.
export const PROGRESS_TEXT_LIMIT = 120;
// A working builder that has not produced any step for this long is "sin
// movimiento hace N min".
export const IDLE_MINUTES = 5;

const STATUS_BY_RAW = {
  completed: "done",
  in_progress: "doing",
  pending: "todo"
};

// Maps a raw status to the three progress states. `cancelled` (and any unknown
// value) is dropped: it does not count towards total nor done.
export function progressStatus(value) {
  return STATUS_BY_RAW[String(value ?? "").trim().toLowerCase()] ?? null;
}

// Normalizes a raw todo list: keeps only known statuses, caps the text at
// PROGRESS_TEXT_LIMIT chars and reads the text from the field each engine uses
// (OpenCode `content`, Codex `step`, Claude `content`).
export function normalizeTodos(todos) {
  const items = [];
  for (const todo of Array.isArray(todos) ? todos : []) {
    if (!todo || typeof todo !== "object") continue;
    const status = progressStatus(todo.status);
    if (!status) continue;
    const text = capText(todo.content ?? todo.step ?? todo.text ?? todo.activeForm);
    if (!text) continue;
    items.push({ text, status });
  }
  return items;
}

// Shared shape of `worker.progress`:
// { items, done, total, current, firstAt, lastStepAt }. `current` is the first
// doing item, else the first todo, else null.
export function buildProgress({ todos, firstAt, lastStepAt } = {}) {
  const items = normalizeTodos(todos);
  const done = items.reduce((count, item) => count + (item.status === "done" ? 1 : 0), 0);
  const currentItem = items.find((item) => item.status === "doing") ?? items.find((item) => item.status === "todo") ?? null;
  return {
    items,
    done,
    total: items.length,
    current: currentItem ? currentItem.text : null,
    firstAt: isoOrNull(firstAt),
    lastStepAt: isoOrNull(lastStepAt)
  };
}

// Estimated remaining time, in the console's short format: minutes:seconds
// below one hour, hours:minutes with the ` h` suffix above it. A projection
// already in the past reads ~0:00 (the pace chip carries the "demorado").
export function formatProgressRemaining(ms) {
  const left = Number(ms);
  if (!Number.isFinite(left) || left <= 0) return "~0:00";
  if (left < 3600000) {
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor(left / 1000) % 60;
    return `~${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(left / 3600000);
  const minutes = Math.floor(left / 60000) % 60;
  return `~${hours}:${String(minutes).padStart(2, "0")} h`;
}

// Measured remaining time and pace of one worker.
// - With `done >= 1` and a known `firstAt`: rate = (now - firstAt) / done and
//   projectedEnd = now + rate * (total - done). All done reads "listo".
// - Otherwise (no progress, done 0, or no firstAt) it returns the fallback
//   text, which the caller builds with the existing resolveRemainingText so
//   status and evidence still win.
// - `pace` compares projectedEnd with etaEnd within 10 % of the planned
//   duration (etaEnd - firstAt): "adelantado", "en hora" or "demorado". Without
//   etaEnd (or without a usable window) it is null.
export function progressPace({ progress, etaEnd, now = new Date(), fallbackText } = {}) {
  const fallback = fallbackText ?? resolveRemainingText({ etaEnd, now });
  const eta = parseEtaEnd(etaEnd);
  const at = now instanceof Date ? now : new Date(now);
  if (!progress || !(progress.total > 0) || !(progress.done >= 1)) {
    return { remainingText: fallback, pace: null };
  }
  const first = parseEtaEnd(progress.firstAt);
  if (progress.done >= progress.total) {
    return { remainingText: "listo", pace: first ? paceFor(eta, first, at, at) : null };
  }
  if (!first || at.getTime() <= first.getTime()) {
    return { remainingText: fallback, pace: null };
  }
  const rate = (at.getTime() - first.getTime()) / progress.done;
  const projectedEnd = at.getTime() + rate * (progress.total - progress.done);
  return {
    remainingText: formatProgressRemaining(projectedEnd - at.getTime()),
    pace: paceFor(eta, first, at, new Date(projectedEnd))
  };
}

// Adds `progress`/`lastStepAt` to an adapter activity result only when they
// carry data, so a worker without a todo list keeps the plain { events,
// notice } shape.
export function withActivityProgress(result, progress, lastStepAt) {
  const out = { ...result };
  if (progress) out.progress = progress;
  if (lastStepAt) out.lastStepAt = lastStepAt;
  return out;
}

// "sin movimiento hace N min" when the newest step is IDLE_MINUTES or older
// (N rounded down); null otherwise. The caller decides when the worker state
// makes this relevant (working only).
export function idleText({ lastStepAt, now = new Date() } = {}) {
  const last = parseEtaEnd(lastStepAt);
  if (!last) return null;
  const at = now instanceof Date ? now : new Date(now);
  const minutes = Math.floor((at.getTime() - last.getTime()) / 60000);
  if (minutes < IDLE_MINUTES) return null;
  return `sin movimiento hace ${minutes} min`;
}

function paceFor(eta, first, now, projectedEnd) {
  if (!eta) return null;
  const planned = eta.getTime() - first.getTime();
  if (!(planned > 0)) return null;
  const tolerance = planned * 0.1;
  if (projectedEnd.getTime() < eta.getTime() - tolerance) return "adelantado";
  if (projectedEnd.getTime() > eta.getTime() + tolerance) return "demorado";
  return "en hora";
}

function capText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, PROGRESS_TEXT_LIMIT);
}

function isoOrNull(value) {
  const date = parseEtaEnd(value);
  return date ? date.toISOString() : null;
}
