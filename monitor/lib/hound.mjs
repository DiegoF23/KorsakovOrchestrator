// The hound: when a worker's runner is gone (Windows reused its pid for another
// process, or the process died mid-run) the supervisor never writes a final
// status. The hound asks the free OpenCode helper (the same one the translator
// uses) to decide from the evidence whether the run finished ("done") or failed
// ("error"). Verdicts are cached in a git-ignored JSON keyed by
// project + track + status time, so a verdict survives a restart and a new run
// of the same track (a new status time) is judged again. Every call runs in the
// background, at most one at a time, and a failure retries later with backoff.
// The monitor never writes into the judged project's own kit or status files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MODEL, helperSettings, runHelper } from "./translate.mjs";

export const DEFAULT_HOUND_MODEL = DEFAULT_MODEL;
export const MAX_EVIDENCE_STEPS = 10;
export const MAX_EVIDENCE_COMMITS = 20;

const DEFAULT_CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "verdicts.json");

export const HOUND_PROMPT = [
  "Sos el sabueso del monitor de la flota: un worker quedó huérfano porque su proceso ya no corre o Windows reutilizó su pid.",
  "A partir de la evidencia decidí si el trabajo TERMINÓ bien o si FALLÓ.",
  'Responder SOLO con un objeto JSON de una línea, sin texto extra ni bloques de código: {"verdict":"done"|"error","reason":"<una sola frase corta en español>"}.',
  'Usá "done" si la evidencia muestra el trabajo completado; "error" si quedó a medias, falló o no hay señales de cierre.',
  "Evidencia:"
].join(" ");

// The cache key: a new run of the same track writes a new status time, so it
// gets judged again instead of reusing the old verdict.
export function verdictKey(projectId, trackName, statusTime) {
  const project = String(projectId ?? "").trim() || "default";
  return `${project}|${String(trackName ?? "").trim()}|${String(statusTime ?? "").trim()}`;
}

// Strict parse: only a JSON object with verdict done|error and a non-empty
// reason counts. Prose, a code fence around the object, a missing field or an
// unknown verdict is no verdict, and the caller retries later.
export function parseVerdict(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const verdict = parsed?.verdict;
  if (verdict !== "done" && verdict !== "error") return null;
  const reason = String(parsed?.reason ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!reason) return null;
  return { verdict, reason: reason.slice(0, 200) };
}

export function buildHoundPrompt(evidence = {}) {
  const progress = evidence.progress ?? {};
  const steps = (Array.isArray(evidence.steps) ? evidence.steps : []).slice(-MAX_EVIDENCE_STEPS);
  const commits = (Array.isArray(evidence.commits) ? evidence.commits : []).slice(0, MAX_EVIDENCE_COMMITS);
  const lines = [
    `pista: ${evidence.trackName ?? ""}`,
    `título: ${evidence.title ?? ""}`,
    `estado: ${evidence.statusText ?? ""}`,
    `progreso: ${Number(progress.done) || 0}/${Number(progress.total) || 0}`,
    "últimos pasos:"
  ];
  for (const step of steps) lines.push(`- ${String(step ?? "")}`);
  lines.push("commits desde el inicio:");
  if (commits.length === 0) lines.push("- (sin commits)");
  for (const commit of commits) lines.push(`- ${String(commit ?? "")}`);
  return `${HOUND_PROMPT}\n${lines.join("\n")}`;
}

// The model the hound runs with: `hound.model` from the config, or the free
// default. `hound.enabled: false` turns the whole hound off.
export function houndModel(ctx) {
  return String(ctx?.config?.hound?.model ?? "").trim() || DEFAULT_HOUND_MODEL;
}

export function houndEnabled(ctx) {
  return ctx?.config?.hound?.enabled !== false;
}

// The request handed to the runner: the shared helper settings plus the prompt.
// Null when there is no helper (no exe or no server), like the translator.
export function houndRequest(ctx, evidence) {
  if (!houndEnabled(ctx)) return null;
  const helper = helperSettings(ctx, houndModel(ctx));
  if (!helper) return null;
  return { helper, prompt: buildHoundPrompt(evidence) };
}

// Stateful service: one JSON cache, at most one helper call in flight, and an
// exponential backoff after failures so a dead server is not hammered.
export function createHoundService(options = {}) {
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const runner = options.runner ?? runHelper;
  const now = options.now ?? (() => Date.now());
  const baseBackoffMs = Number(options.baseBackoffMs) > 0 ? Number(options.baseBackoffMs) : 60_000;
  const maxBackoffMs = Number(options.maxBackoffMs) > 0 ? Number(options.maxBackoffMs) : 15 * 60_000;

  const store = loadStore(cacheFile);
  let inflight = null;
  let failures = 0;
  let nextAttemptAt = 0;

  // Returns the cached verdict for the key, or null. When a request builder is
  // given, a missing verdict schedules at most one background call.
  function verdictFor(key, makeRequest) {
    if (!key) return null;
    const cached = store[key];
    if (cached) return cached;
    if (makeRequest) start(key, makeRequest);
    return null;
  }

  function start(key, makeRequest) {
    if (inflight || now() < nextAttemptAt) return;
    inflight = Promise.resolve()
      .then(async () => {
        const request = typeof makeRequest === "function" ? await makeRequest() : makeRequest;
        // Hound off or no helper: nothing to judge, and no backoff either.
        if (!request) return;
        if (!request.helper || !request.prompt) throw new Error("sin helper para el sabueso");
        const reply = await runner({
          exe: request.helper.exe,
          server: request.helper.server,
          model: request.helper.model,
          title: "monitor-hound",
          prompt: request.prompt
        });
        const verdict = parseVerdict(reply);
        if (!verdict) throw new Error("la respuesta no trajo veredicto");
        store[key] = verdict;
        saveStore(cacheFile, store);
        failures = 0;
        nextAttemptAt = 0;
      })
      .catch(() => {
        failures += 1;
        nextAttemptAt = now() + Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.min(failures - 1, 8));
      })
      .finally(() => {
        inflight = null;
      });
  }

  async function flush() {
    let guard = 0;
    while (inflight && guard < 10) {
      try {
        await inflight;
      } catch {
        // start() handles its own failures; the guard is only for safety.
      }
      guard += 1;
    }
  }

  return { verdictFor, flush };
}

// The server builds a fresh snapshot on every poll; this singleton keeps the
// cache and the in-flight call across requests.
let defaultService = null;

export function houndVerdict(key, makeRequest) {
  try {
    if (!defaultService) defaultService = createHoundService();
    return defaultService.verdictFor(key, makeRequest);
  } catch {
    return null;
  }
}

function loadStore(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(file, store) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch {
    // Best effort: without the cache the worker is judged again later.
  }
}
