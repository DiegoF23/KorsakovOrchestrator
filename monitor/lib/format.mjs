// Pure helpers shared by the monitor server and its tests. They mirror the
// behavior of tools/autopilot/monitor-common.ps1 so the web page shows the same
// titles, states and countdowns as the terminal panes.

const SHORT_PATH_LIMIT = 55;

export function parseEtaEnd(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRemaining(etaEnd, now = new Date()) {
  const eta = parseEtaEnd(etaEnd);
  if (!eta) return "";
  const leftMs = eta.getTime() - now.getTime();
  if (leftMs <= 0) {
    return `~0:00 (excedido +${Math.ceil(-leftMs / 60000)} min)`;
  }
  const hours = Math.floor(leftMs / 3600000);
  const minutes = Math.floor(leftMs / 60000) % 60;
  return `~${hours}:${String(minutes).padStart(2, "0")}`;
}

export function stateFromStatus(status) {
  if (!status || status.state !== "finished") return null;
  if (Number(status.exitCode) === 5) return "esperando";
  return Number(status.exitCode) === 0 ? "terminado" : "detenido";
}

export function stateFromEvidence(text, prefix) {
  if (!text || !prefix) return null;
  const escaped = escapeRegExp(prefix);
  if (new RegExp(`^${escaped}: DONE`, "im").test(text)) return "terminado";
  if (new RegExp(`^${escaped}: BLOCKED`, "im").test(text)) return "detenido";
  return null;
}

export function resolveRemainingText({ status, evidenceText, prefix, etaEnd, now = new Date() }) {
  // A waiting supervisor says so, even if an older DONE line is in the evidence.
  if (status?.state === "waiting") return "esperando";
  // The evidence STATUS line only decides when the supervisor has not reported.
  const fromEvidence = status ? null : stateFromEvidence(evidenceText, prefix);
  return stateFromStatus(status) ?? fromEvidence ?? formatRemaining(etaEnd, now);
}

// Colour family of a worker card. Working cards are amber, finished cards
// green, cards stopped by an error or a BLOCKED line red, and every other
// state (waiting, queued, relaunching, "esperando", unknown) cyan. A live
// builder whose supervisor heartbeat is late is blue ("sin reporte reciente"),
// never red. The page applies the family as the `state-*` / `badge-*` class.
const WORKING_STATES = new Set(["working", "running", "active"]);
const STALE_STATES = new Set(["stale", "sin reporte reciente"]);
const DONE_STATES = new Set(["done", "finished", "ok", "terminado"]);
const ERROR_STATES = new Set(["error", "blocked", "detenido", "failed", "stopped"]);

export function workerStateKind(state) {
  const value = String(state ?? "").trim().toLowerCase();
  if (WORKING_STATES.has(value)) return "working";
  if (DONE_STATES.has(value)) return "done";
  if (ERROR_STATES.has(value)) return "error";
  if (STALE_STATES.has(value)) return "stale";
  return "waiting";
}

// "deepseek-v4.1-flash · max" / "gpt-6.1-sol · medium": the model with its
// effort level, never the word "esfuerzo". Missing halves are omitted.
export function modelLabel(model, effort) {
  const name = String(model ?? "").trim();
  const level = String(effort ?? "").trim();
  if (!name) return level || "?";
  return level ? `${name} · ${level}` : name;
}

export function trackLetter(track) {
  const letter = String(track?.letter ?? "").trim().toUpperCase();
  if (/^[A-H]$/.test(letter)) return letter;
  const match = /OpenCode\s*([A-H])\b/i.exec(String(track?.label ?? ""));
  return match ? match[1].toUpperCase() : "";
}

export function trackIdentity(engine, track) {
  if (engine === "codex") return "CODEX";
  if (engine === "claude-code") return "CLAUDE";
  if (engine === "antigravity") return "ANTIGRAVITY";
  const letter = trackLetter(track);
  return letter ? `OPENCODE ${letter}` : "OPENCODE";
}

export function trackShortTitle(track) {
  const title = track?.title ?? track?.label;
  return title ? String(title) : "";
}

export function builderTitle(identity, title, remaining) {
  return [identity, title, remaining].filter(Boolean).join(" - ");
}

// Activity lines per worker card: the page shrinks them as builders multiply so
// one screen keeps fitting without scrolling (8 up to 4 workers, 4 up to 8, 2 beyond).
export function activityLineBudget(workerCount) {
  const count = Number(workerCount) || 0;
  if (count <= 4) return 8;
  if (count <= 8) return 4;
  return 2;
}

// "actualizado hace 12 min" for the usage meters. Never invents an age: an
// unknown age returns an empty string, the page simply shows nothing.
export function formatUsageAge(ageMinutes) {
  if (ageMinutes === null || ageMinutes === undefined) return "";
  const minutes = Math.floor(Number(ageMinutes));
  if (!Number.isFinite(minutes) || minutes < 1) return "actualizado hace menos de 1 min";
  if (minutes < 60) return `actualizado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `actualizado hace ${hours} h`
    : `actualizado hace ${hours} h ${String(rest).padStart(2, "0")} min`;
}

export function shortText(value, max = 150) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function firstSentence(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = /^[^.!?\n]{1,200}[.!?]/.exec(text);
  return match ? match[0].trim() : shortText(text, 200);
}

export function shortPath(value, repo, worktreeParent) {
  if (!value) return value;
  const normalized = String(value).replace(/\//g, "\\");
  const worktrees = trimTrailingSlash(worktreeParent);
  const repoRoot = trimTrailingSlash(repo);
  let stripped = null;
  if (worktrees) {
    const pattern = new RegExp(`^${escapeRegExp(worktrees)}\\\\[^\\\\]+\\\\`, "i");
    if (pattern.test(normalized)) stripped = normalized.replace(pattern, "");
  }
  if (stripped === null && repoRoot) {
    const pattern = new RegExp(`^${escapeRegExp(repoRoot)}\\\\`, "i");
    if (pattern.test(normalized)) stripped = normalized.replace(pattern, "");
  }
  if (stripped === null) return value;
  if (stripped.length > SHORT_PATH_LIMIT) {
    const segments = stripped.split("\\").filter(Boolean);
    if (segments.length > 3) return `...\\${segments.slice(-3).join("\\")}`;
  }
  return stripped;
}

function trimTrailingSlash(value) {
  return value ? String(value).replace(/[\\/]+$/, "") : "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
