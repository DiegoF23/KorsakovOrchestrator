// Spanish display layer for the fleet monitor: it translates git commit
// subjects and writes one short Spanish summary per working builder, both with
// the free helper model of the shared OpenCode server (the same idea as
// board.ps1's commit-es.json). Translations are cached by commit SHA in
// translations.json so a commit is translated once; summaries are cached per
// worker and activity signature. Every model call runs in the background, one
// at a time, and any failure keeps the English text and retries later with
// backoff. The English original always stays in the snapshot.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MODEL = "opencode-go/beam-free";
export const MAX_BATCH = 40;
export const MAX_SUMMARY_CHARS = 120;
export const MAX_SUMMARY_EVENTS = 20;
export const DEFAULT_SUMMARY_SECONDS = 120;

const DEFAULT_CACHE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "translations.json"
);
const COMMIT_PREFIX = /^([a-zA-Z][a-zA-Z0-9-]*(?:\([^)]*\))?!?:\s*)/;
const COMMIT_PROMPT = [
  "Traduce al español (es-AR neutro, sin voseo) el asunto de cada commit de git.",
  "Mantener sin cambios el prefijo tipo(alcance): de Conventional Commits, los nombres de código, rutas, comandos e IDs.",
  "Glosario obligatorio: driver = chofer, drivers = choferes, member = miembro, override = excepción de permiso, slice = slice, track = pista, evidence = evidencia.",
  "Responder SOLO con una línea por commit, en el mismo orden, con el formato exacto: <número><TAB><traducción>. Commits:"
].join(" ");
const SUMMARY_PROMPT = [
  "Resumí en una sola línea en español (es-AR neutro, sin voseo, hasta 120 caracteres)",
  "qué está haciendo el agente ahora, a partir de estos eventos (tipo y detalle):"
].join(" ");

// "1\ttexto" lines, mapped by their own number so a shuffled reply still lands
// on the right commit. When the helper ignores the numbering and answers with
// one bare line per item, the order is used instead.
export function parseNumberedReply(text, count) {
  const results = new Array(Math.max(0, Number(count) || 0)).fill(null);
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let numbered = 0;
  for (const line of lines) {
    const match = /^(\d{1,3})\s*(?:[\t.:)]|-\s)\s*(.+)$/.exec(line);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= results.length || results[index] !== null) continue;
    const value = cleanLine(match[2]);
    if (!value) continue;
    results[index] = value;
    numbered += 1;
  }
  if (numbered > 0) return results;
  if (lines.length === results.length) return lines.map(cleanLine);
  return results;
}

// The Conventional Commit prefix (type, optional scope, breaking `!`) is a
// technical token: whatever the helper returns, the English prefix is restored
// exactly as written in git.
export function applyPrefix(original, translated) {
  const text = cleanLine(translated);
  const source = COMMIT_PREFIX.exec(String(original ?? ""));
  if (!source) return text;
  const target = COMMIT_PREFIX.exec(text);
  if (target) return source[1] + text.slice(target[1].length);
  return source[1] + text;
}

export function cleanSummary(value, max = MAX_SUMMARY_CHARS) {
  const line =
    String(value ?? "")
      .split(/\r?\n/)
      .map((piece) => piece.trim())
      .find(Boolean) ?? "";
  const text = cleanLine(line.replace(/^[\s>*\-•)]+/, ""));
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

// Stateful service: one JSON cache, at most one helper call in flight, and an
// exponential backoff after failures so a dead server is not hammered.
export function createTranslationService(options = {}) {
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const runner = options.runner ?? runHelper;
  const now = options.now ?? (() => Date.now());
  const baseBackoffMs = Number(options.baseBackoffMs) > 0 ? Number(options.baseBackoffMs) : 60_000;
  const maxBackoffMs = Number(options.maxBackoffMs) > 0 ? Number(options.maxBackoffMs) : 15 * 60_000;
  const defaultSummaryMs =
    (Number(options.summarySeconds) > 0 ? Number(options.summarySeconds) : DEFAULT_SUMMARY_SECONDS) * 1000;

  const store = loadStore(cacheFile);
  const summaryAttempts = new Map();
  let inflight = null;
  let failures = 0;
  let nextAttemptAt = 0;

  function enrich(snapshot = {}, ctx = {}) {
    const settings = ctx.config?.translate ?? {};
    if (settings.enabled === false) return snapshot;
    const helper = helperSettings(ctx);
    const pendingCommits = new Map();

    for (const commit of snapshot.git?.commits ?? []) {
      if (!commit?.sha || !commit.subject) continue;
      const cached = store.commits[commit.sha];
      if (cached) commit.subjectEs = cached;
      else pendingCommits.set(commit.sha, commit.subject);
    }

    const summaryIntervalMs =
      Number(settings.summarySeconds) > 0 ? Number(settings.summarySeconds) * 1000 : defaultSummaryMs;
    const pendingSummaries = [];
    // Hidden cards are done or error, so they only need their last commit
    // translated for the moment the page shows them again.
    for (const card of [...(snapshot.workers ?? []), ...(snapshot.hiddenWorkers ?? [])]) {
      const last = card?.lastCommit;
      if (last?.sha && last.subject) {
        const cached = store.commits[last.sha];
        if (cached) last.subjectEs = cached;
        else pendingCommits.set(last.sha, last.subject);
      }
      if (!isWorking(card)) continue;
      const sig = activitySignature(card.activity?.events);
      if (!sig) continue;
      const key = summaryKey(ctx.projectId, card.name);
      const cached = store.summaries[key];
      if (cached && cached.sig === sig) {
        card.summaryEs = cached.text;
        continue;
      }
      const lastAttempt = summaryAttempts.get(key) ?? -Infinity;
      if (now() - lastAttempt < summaryIntervalMs) continue;
      pendingSummaries.push({
        name: card.name,
        key,
        sig,
        events: (card.activity?.events ?? []).slice(-MAX_SUMMARY_EVENTS)
      });
    }

    if (!helper || inflight || now() < nextAttemptAt) return snapshot;
    if (!pendingCommits.size && !pendingSummaries.length) return snapshot;

    const batch = [...pendingCommits.entries()]
      .slice(0, MAX_BATCH)
      .map(([sha, subject]) => ({ sha, subject }));
    const summaries = batch.length ? [] : pendingSummaries.slice(0, 1);
    for (const item of summaries) summaryAttempts.set(item.key, now());
    start(helper, batch, summaries);
    return snapshot;
  }

  function start(helper, commits, summaries) {
    inflight = Promise.resolve()
      .then(() => runCycle(helper, commits, summaries))
      .catch(() => {
        // runCycle handles its own failures; this is only a safety net.
      })
      .finally(() => {
        inflight = null;
      });
  }

  async function runCycle(helper, commits, summaries) {
    try {
      if (commits.length) {
        const reply = await runner({
          exe: helper.exe,
          server: helper.server,
          model: helper.model,
          title: "monitor-translate",
          prompt: commitPrompt(commits)
        });
        const parsed = parseNumberedReply(reply, commits.length);
        let changed = 0;
        commits.forEach((item, index) => {
          const text = parsed[index];
          if (!text) return;
          const translated = applyPrefix(item.subject, text);
          if (!translated) return;
          store.commits[item.sha] = translated;
          changed += 1;
        });
        if (!changed) throw new Error("la respuesta no trajo traducciones");
        saveStore(cacheFile, store);
        if (changed < commits.length) throw new Error("la respuesta no tradujo todos los commits");
      } else if (summaries.length) {
        const item = summaries[0];
        const reply = await runner({
          exe: helper.exe,
          server: helper.server,
          model: helper.model,
          title: "monitor-summary",
          prompt: summaryPrompt(item.events)
        });
        const text = cleanSummary(reply);
        if (!text) throw new Error("la respuesta no trajo resumen");
        store.summaries[item.key] = { sig: item.sig, text };
        saveStore(cacheFile, store);
      }
      failures = 0;
      nextAttemptAt = 0;
    } catch (error) {
      failures += 1;
      nextAttemptAt = now() + Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.min(failures - 1, 8));
      console.error(`translate: ${String(error?.message ?? error).slice(0, 300)} (retry in ${Math.round((nextAttemptAt - now()) / 1000)} s)`);
    }
  }

  async function flush() {
    let guard = 0;
    while (inflight && guard < 10) {
      const current = inflight;
      try {
        await current;
      } catch {
        // runCycle never rejects; the guard is only for safety.
      }
      guard += 1;
    }
  }

  return { enrich, flush };
}

// The server builds a fresh snapshot on every poll; this singleton keeps the
// cache and the in-flight call across requests.
let defaultService = null;

export function enrichSnapshot(snapshot, ctx = {}) {
  try {
    if (!defaultService) defaultService = createTranslationService();
    return defaultService.enrich(snapshot, ctx);
  } catch {
    return snapshot;
  }
}

// Stable working directory for the helper call: the monitor folder is a
// project the attached server already knows, instead of a fresh temp dir that
// would register a new one on every translation.
export const HELPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The prompt never travels in the command line: cmd.exe mangles the newlines
// and tabs of a batch prompt into a truncated message, so runHelper writes it
// to stdin instead (opencode uses stdin as the message when no positional
// message is given).
export function buildHelperArgs({ server, model, title = "monitor-translate", dir = HELPER_DIR } = {}) {
  return [
    "run",
    "--attach",
    String(server ?? ""),
    "--format",
    "json",
    "-m",
    String(model ?? ""),
    "--dir",
    dir,
    "--title",
    title
  ];
}

// Default runner: the same lean helper call board.ps1 makes, but with the
// prompt on stdin.
export async function runHelper({ exe, server, model, title = "monitor-translate", prompt = "", timeoutMs = 120_000 } = {}) {
  const stdout = await spawnCapture(exe, buildHelperArgs({ server, model, title }), timeoutMs, prompt);
  return collectText(stdout);
}

export function collectText(stdout) {
  let text = "";
  for (const rawLine of String(stdout ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "text" && event.part?.text) text += String(event.part.text);
    } catch {
      // Non-JSON noise from the CLI: ignore it.
    }
  }
  return text.trim();
}

// The shared OpenCode helper used by the Spanish display layer. `model`
// overrides the translate default (the hound uses its own free model). The exe
// and server come from the project's kit; a project without one (no kit
// declared) uses translate.helperExe and translate.server from the config, and
// without either there is no helper.
export function helperSettings(ctx, model) {
  const chosen = String(model ?? ctx.config?.translate?.model ?? "").trim() || DEFAULT_MODEL;
  const exe = String(ctx.kit?.helperExe || ctx.kit?.opencodeExe || "").trim();
  const host = ctx.kit?.server?.host;
  const port = Number(ctx.kit?.server?.port);
  if (exe && host && Number.isFinite(port) && port > 0) {
    return { exe, server: `http://${host}:${port}`, model: chosen };
  }
  const fallbackExe = String(ctx.config?.translate?.helperExe ?? "").trim();
  const fallbackServer = String(ctx.config?.translate?.server ?? "").trim();
  if (!fallbackExe || !/^https?:\/\//.test(fallbackServer)) return null;
  return { exe: fallbackExe, server: fallbackServer.replace(/\/+$/, ""), model: chosen };
}

function isWorking(card) {
  return (card?.stateKind || card?.state) === "working";
}

// Two projects may name a track the same (for example "api"), so the summary
// cache and the per-worker interval are keyed by project id when the snapshot
// carries one.
function summaryKey(projectId, name) {
  const project = String(projectId ?? "").trim();
  return project ? `${project}:${name}` : String(name ?? "");
}

function activitySignature(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return "";
  const last = list[list.length - 1] ?? {};
  return `${list.length}|${last.time ?? ""}|${String(last.detail ?? "").slice(0, 120)}`;
}

function commitPrompt(items) {
  const lines = items.map((item, index) => `${index + 1}\t${item.subject}`);
  return `${COMMIT_PROMPT}\n${lines.join("\n")}`;
}

function summaryPrompt(events) {
  const lines = (events ?? []).map((event) => `${event?.kind ?? ""}: ${event?.detail ?? ""}`.trim());
  return `${SUMMARY_PROMPT}\n${lines.join("\n")}`;
}

function cleanLine(value) {
  return String(value ?? "")
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadStore(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      commits: parsed?.commits && typeof parsed.commits === "object" ? parsed.commits : {},
      summaries: parsed?.summaries && typeof parsed.summaries === "object" ? parsed.summaries : {}
    };
  } catch {
    return { commits: {}, summaries: {} };
  }
}

function saveStore(file, store) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = JSON.stringify({ version: 1, commits: store.commits, summaries: store.summaries }, null, 2);
    fs.writeFileSync(file, `${body}\n`, "utf8");
  } catch {
    // Best effort: without the cache the page still shows the English text.
  }
}

function spawnCapture(exe, args, timeoutMs, stdinText = "") {
  return new Promise((resolve, reject) => {
    // A .cmd/.bat helper (the npm shim of opencode) is run through cmd.exe with
    // the same quoting board.ps1 uses, so paths with spaces survive. The command
    // line goes verbatim: Node must not re-escape the cmd quoting.
    const useShell = /\.(cmd|bat)$/i.test(exe);
    const file = useShell ? process.env.ComSpec || "cmd.exe" : exe;
    const options = { windowsHide: true };
    let spawnArgs = args;
    if (useShell) {
      spawnArgs = ["/d", "/s", "/c", `"${[exe, ...args].map(quoteCmdArg).join(" ")}"`];
      options.windowsVerbatimArguments = true;
    }
    let child;
    try {
      child = spawn(file, spawnArgs, options);
    } catch (error) {
      reject(error);
      return;
    }
    // opencode takes the prompt from stdin and does not answer until stdin
    // closes: leaving the pipe open is what used to hang every call.
    child.stdin?.on("error", () => {});
    child.stdin?.end(String(stdinText ?? ""));
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("el helper no respondió a tiempo"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`el helper terminó con código ${code}: ${String(stderr).slice(0, 200)}`));
    });
  });
}

// cmd.exe is only the wrapper: the opencode process is its child, so a plain
// child.kill() would leave it running.
function killTree(child) {
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      return;
    } catch {
      // Fall through to the plain kill below.
    }
  }
  child.kill();
}

function quoteCmdArg(value) {
  const text = String(value ?? "");
  return /[\s"&<>|^]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
