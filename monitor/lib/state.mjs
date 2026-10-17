// Builds the read-only snapshot served by GET /api/state. Every section is
// tolerant: a missing file, a dead OpenCode server or a missing git repo must
// never take the page down.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as antigravity from "../adapters/antigravity.mjs";
import * as claude from "../adapters/claude-code.mjs";
import * as codex from "../adapters/codex.mjs";
import * as opencode from "../adapters/opencode.mjs";
import {
  builderTitle,
  resolveRemainingText,
  trackIdentity,
  trackShortTitle,
  activityLineBudget,
  formatUsageAge,
  modelLabel,
  workerStateKind
} from "./format.mjs";
import { assignLanes, branchColor, branchColorIndex, collectBranches, NEUTRAL_BRANCH_COLOR, parseGitLog } from "./graph.mjs";
import { houndRequest, houndVerdict, verdictKey } from "./hound.mjs";
import { idleText, progressPace } from "./progress.mjs";
import { enrichSnapshot } from "./translate.mjs";

const execFileAsync = promisify(execFile);

const ADAPTERS = { claude, codex, opencode, antigravity };
const ENGINE_TO_ADAPTER = { "claude-code": "claude", codex: "codex", opencode: "opencode", antigravity: "antigravity" };
const STATE_TEXT = { working: "trabajando", done: "terminado", error: "detenido", waiting: "esperando", stale: "sin reporte reciente" };
// Shown while an orphaned worker waits for the hound's verdict; it never reads
// "sin reporte reciente" (stale) again.
export const ORPHAN_PENDING_TEXT = "proceso perdido · analizando";
// The singleton hound service, lazily created by houndVerdict on first use.
const defaultHound = { verdictFor: (key, makeRequest) => houndVerdict(key, makeRequest) };
// The git panel scrolls on its own, so it can afford the whole recent history.
export const GIT_LOG_LIMIT = 200;
export const DEFAULT_PROJECT_ID = "default";
const cache = new Map();
const inflight = new Map();

const PC_SCRIPT =
  "$ErrorActionPreference='SilentlyContinue'; " +
  "$cpu=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime; " +
  "$os=Get-CimInstance Win32_OperatingSystem; " +
  "$ram=if ($os) { [math]::Round((1-$os.FreePhysicalMemory/$os.TotalVisibleMemorySize)*100) } else { -1 }; " +
  "$c=Get-PSDrive C; " +
  "$disk=if ($c -and ($c.Used + $c.Free) -gt 0) { [math]::Round($c.Used/($c.Used+$c.Free)*100) } else { -1 }; " +
  "\"$cpu|$ram|$disk\"";

export function loadConfig(file) {
  const configPath = path.resolve(file);
  const baseDir = path.dirname(configPath);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  const resolve = (value) => (value ? path.resolve(baseDir, expandVars(String(value))) : null);
  return {
    ...raw,
    __file: configPath,
    __baseDir: baseDir,
    __mtimeMs: mtimeMs,
    workers: { ...(raw.workers ?? {}), kitConfig: resolve(raw.workers?.kitConfig ?? "../autopilot/kit.config.json") },
    claude: { ...(raw.claude ?? {}), usageFile: resolve(raw.claude?.usageFile) },
    codex: { ...(raw.codex ?? {}), sessionsDir: raw.codex?.sessionsDir ? expandVars(String(raw.codex.sessionsDir)) : null },
    opencode: {
      ...(raw.opencode ?? {}),
      officialFile: resolve(raw.opencode?.officialFile),
      accountFile: resolve(raw.opencode?.accountFile),
      estimateScript: resolve(raw.opencode?.estimateScript)
    },
    repo: resolve(raw.repo) ?? null
  };
}

// Normalizes the watch list of the monitor config. Without a `projects` array
// the single implicit project reproduces today's behavior: top-level `repo`
// and `workers.kitConfig`, id "default" and the repo folder as name. Each
// explicit entry is `{ id, name, repo, kitConfig }`; repo and kitConfig
// resolve like the top-level ones (against the config folder, with %VARS% and
// ~ expanded) and name defaults to the repo folder. Pure and exported so the
// normalization is unit-testable.
// Projects Claude Code knows about: every folder of ~/.claude/projects with a
// session, resolved to its real working directory (the transcripts record
// "cwd"; the folder name alone is lossy). Git worktrees and temp folders are
// and Claude scratch workspaces are skipped, and the newest project comes first.
// Opt-in with "discoverClaudeProjects": true in the config. Cached briefly because the
// project list is resolved on every request.
const DISCOVERY_TTL_MS = 30000;
let discoveryCache = { key: "", at: 0, value: [] };

export function discoverClaudeProjects(home = os.homedir(), now = Date.now()) {
  const root = path.join(home, ".claude", "projects");
  if (discoveryCache.key === root && now - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.value;
  const found = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    dirs = [];
  }
  const temp = os.tmpdir().toLowerCase();
  for (const dir of dirs) {
    const full = path.join(root, dir.name);
    let newest = null;
    try {
      for (const name of fs.readdirSync(full)) {
        if (!name.endsWith(".jsonl")) continue;
        const mtimeMs = fs.statSync(path.join(full, name)).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { file: path.join(full, name), mtimeMs };
      }
    } catch {
      continue;
    }
    if (!newest) continue;
    const head = readFileHead(newest.file, 32768) ?? "";
    const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
    if (!cwd) continue;
    let repo;
    try {
      repo = JSON.parse(`"${cwd}"`);
    } catch {
      continue;
    }
    if (!fs.existsSync(repo) || (repo.toLowerCase() === temp || repo.toLowerCase().startsWith(temp + path.sep)) || /scratch-workspaces/i.test(repo)) continue;
    try {
      if (fs.statSync(path.join(repo, ".git")).isFile()) continue;
    } catch {
      // Not a git folder at all: still a project Claude shows.
    }
    found.push({ id: `cc-${dir.name.toLowerCase().replace(/^-+/, "").slice(0, 60)}`, name: path.basename(repo) || repo, repo, mtimeMs: newest.mtimeMs });
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  discoveryCache = { key: root, at: now, value: found };
  return found;
}

export function resolveProjects(config, options = {}) {
  const declared = resolveDeclaredProjects(config);
  if (config?.discoverClaudeProjects !== true) return declared;
  const seen = new Set(declared.map((project) => path.resolve(String(project.repo ?? "")).toLowerCase()));
  const extra = [];
  for (const project of discoverClaudeProjects(options.home)) {
    const key = path.resolve(project.repo).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ id: project.id, name: project.name, repo: project.repo, kitConfig: null });
  }
  return [...declared, ...extra];
}

function resolveDeclaredProjects(config) {
  const source = config ?? {};
  const baseDir = source.__baseDir ?? process.cwd();
  const entries = Array.isArray(source.projects)
    ? source.projects.filter((entry) => entry && typeof entry === "object")
    : [];
  if (entries.length === 0) {
    const repo = resolvePathFrom(baseDir, source.repo);
    return [
      {
        id: DEFAULT_PROJECT_ID,
        name: projectName(repo, DEFAULT_PROJECT_ID),
        repo,
        kitConfig: resolvePathFrom(baseDir, source.workers?.kitConfig)
      }
    ];
  }
  return entries.map((entry, index) => {
    const id = String(entry.id ?? "").trim() || `${DEFAULT_PROJECT_ID}-${index + 1}`;
    const repo = resolvePathFrom(baseDir, entry.repo);
    return {
      id,
      name: String(entry.name ?? "").trim() || projectName(repo, id),
      repo,
      kitConfig: resolvePathFrom(baseDir, entry.kitConfig)
    };
  });
}

function resolvePathFrom(baseDir, value) {
  return value ? path.resolve(baseDir, expandVars(String(value))) : null;
}

function projectName(repo, fallback) {
  const base = repo ? path.basename(repo) : "";
  return base || fallback;
}

// Header data of the orchestrator: engine, model and effort as declared in
// fleet-monitor.config.json, plus the ready-to-show "model · effort" text.
// When the orchestrator is Claude Code and the project has a session
// transcript, the model and effort come from the most recent one (the brain
// follows /model); the config values are only the fallback.
export function orchestratorInfo(config, repo = null, home = os.homedir()) {
  const raw = config?.orchestrator ?? {};
  let model = raw.model ?? "";
  let effort = raw.effort ?? "";
  if ((raw.engine ?? "claude-code") === "claude-code" && repo) {
    const latest = recentClaudeSessions(claudeProjectDir(repo, home), new Date(), { recentMs: Infinity, max: 1 })[0];
    if (latest) {
      const real = transcriptModel(latest.file);
      model = real.model ?? model;
      effort = real.effort ?? effort;
    }
  }
  return {
    engine: raw.engine ?? "claude-code",
    model,
    effort,
    label: raw.label ?? "Orquestador",
    text: modelLabel(model, effort)
  };
}

export async function buildSnapshot(config, options = {}) {
  const now = options.now ?? new Date();
  const project = options.project ?? resolveProjects(config)[0];
  const notices = [];
  const baseDir = config.__baseDir ?? process.cwd();

  let kit = null;
  let kitDir = null;
  if (project.kitConfig) {
    try {
      kit = JSON.parse(fs.readFileSync(project.kitConfig, "utf8"));
      kitDir = path.dirname(project.kitConfig);
    } catch {
      notices.push(`No se pudo leer la configuración del kit: ${project.kitConfig}`);
    }
  } else {
    notices.push("No hay una configuración de kit declarada.");
  }

  await refreshOpenCodeSessions(config, project);
  kit = withOrchestratorTracks(kit, project, config, now);
  const repo =
    project.repo ??
    (kit?.repo ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.repo))) : null);
  const worktreeParent = kit?.worktreeParent
    ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.worktreeParent)))
    : null;
  const ctx = { config, kit, kitDir, repo, worktreeParent, now, project };
  // One PowerShell batch per snapshot resolves the start time of every running
  // pid, so `workerState` can tell a reused pid from the real runner. The hound
  // service decides done vs error for the workers whose runner is gone.
  ctx.pidStart = await processStartLookup(ctx);
  ctx.hound = defaultHound;

  const usages = await usageSnapshot(ctx);
  const builtWorkers = await buildWorkers(ctx);
  const hideResult = hideFinishedWorkers(builtWorkers, config, now);
  const workers = finishedByArrival(hideResult.workers);
  const hiddenWorkers = finishedByArrival(hideResult.hiddenWorkers);
  const hiddenFinished = hideResult.hiddenFinished;
  const pc = await memo("pc", seconds(config.systemCacheSeconds, 10), () => probePc(), {
    cpu: null,
    ram: null,
    diskC: null,
    level: "ok",
    error: "no se pudo leer la carga del PC"
  });
  const git = await memo(`git:${project.id}:${repo ?? ""}`, seconds(config.gitCacheSeconds, 10), () => gitGraph(repo), {
    commits: [],
    branches: [],
    error: "sin repositorio configurado"
  });
  // The cards repeat the colour the tree gives to their branch; a branch with
  // no lane in the visible tree goes neutral. The hidden cards keep the same
  // shape so the page can render them on demand.
  applyBranchColors(workers, git);
  applyBranchColors(hiddenWorkers, git);

  const snapshot = {
    generatedAt: now.toISOString(),
    pollSeconds: Number(config.pollSeconds) || 5,
    project: { id: project.id, name: project.name },
    orchestrator: orchestratorInfo(config, repo),
    // Meters and PC load are hidden unless the config turns them on.
    ui: { showUsage: config?.ui?.showUsage === true, showPc: config?.ui?.showPc === true },
    usages,
    workers,
    hiddenWorkers,
    hiddenFinished,
    activityLines: activityLineBudget(workers.length),
    activityLinesTotal: activityLineBudget(workers.length + hiddenWorkers.length),
    pc,
    git,
    notices
  };
  // Spanish display layer: applies the cached translations and schedules one
  // background helper call at most; it never delays this snapshot. The project
  // id keeps the per-worker summary cache from leaking across projects.
  enrichSnapshot(snapshot, { kit, config, now, projectId: project.id });
  return snapshot;
}

async function usageSnapshot(ctx) {
  const ttl = seconds(ctx.config.usageCacheSeconds, 60);
  // Consumption is global: the cache key ignores the project, so every project
  // shares the same meters.
  return memo(`usage:${ctx.config.__file}:${ctx.config.__mtimeMs ?? 0}`, ttl, async () => {
    const rows = [];
    for (const [adapterId, adapter] of Object.entries(ADAPTERS)) {
      try {
        rows.push(await adapter.usage(ctx));
      } catch {
        rows.push({
          id: adapterId,
          label: adapter.label,
          available: false,
          fiveHour: null,
          week: null,
          extra: "",
          error: "no se pudo leer el consumo"
        });
      }
    }
    const first = ENGINE_TO_ADAPTER[ctx.config.orchestrator?.engine] ?? "claude";
    rows.sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
    for (const row of rows) row.ageText = formatUsageAge(row.ageMinutes);
    return rows;
  }, []);
}

// -- Claude Code orchestrator sessions ---------------------------------------
// Claude Code keeps one JSONL transcript per session in
// ~/.claude/projects/<repo path with every non-alphanumeric char as "-">/.
// Each session touched recently becomes a synthetic claude-code track, so the
// board (and the live viewer) shows the orchestrator working on the project
// without any kit entry. A transcript is "working" while it keeps growing and
// "waiting" while the session sits idle; older sessions are left out.
export const ORCHESTRATOR_TRACK_PREFIX = "claude-";
const ORCHESTRATOR_WORKING_MS = 3 * 60000;
const ORCHESTRATOR_RECENT_MS = 60 * 60000;
const ORCHESTRATOR_MAX_SESSIONS = 3;

// Time of the last event a transcript really recorded (the "timestamp" of its
// last entries). A file's mtime can be refreshed by anything that rewrites the
// folder, so activity is judged by the events, never by the mtime alone.
const lastEventCache = new Map();
export function transcriptLastEventMs(file, mtimeMs, maxBytes = 65536) {
  const cached = lastEventCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
  let value = null;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      let last = null;
      for (const match of buffer.toString("utf8").matchAll(/"timestamp":"([^"]+)"/g)) last = match[1];
      const time = last ? new Date(last).getTime() : NaN;
      value = Number.isFinite(time) ? time : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    value = null;
  }
  lastEventCache.set(file, { mtimeMs, value });
  return value;
}

// Whether the agent has already given its final answer: the last user or
// assistant entry of the transcript is an assistant message with no tool call
// and a normal end of turn. A streamed answer without stop_reason counts once
// the file has been quiet for a few seconds. Cached by mtime.
const turnCache = new Map();
const TURN_QUIET_MS = 8000;
// Subagents launched together share one miniature group: they are clustered by
// launch time (a gap of at most BATCH_GAP_MS keeps them in the same burst) and
// every burst is cut in groups of BATCH_SIZE. The key is the launch time of
// the group's first member, so it stays put while the group ages.
export const BATCH_GAP_MS = 90000;
export const BATCH_SIZE = 4;
export function assignBatches(agents) {
  const sorted = [...agents].sort((a, b) => a.birthMs - b.birthMs);
  const keys = new Map();
  let burst = [];
  const flush = () => {
    for (let i = 0; i < burst.length; i += BATCH_SIZE) {
      const key = `batch-${Math.round(burst[i].birthMs)}`;
      burst.slice(i, i + BATCH_SIZE).forEach((agent) => keys.set(agent.id, key));
    }
    burst = [];
  };
  sorted.forEach((agent) => {
    if (burst.length && agent.birthMs - burst[burst.length - 1].birthMs > BATCH_GAP_MS) flush();
    burst.push(agent);
  });
  flush();
  return keys;
}

export function transcriptTurnComplete(file, mtimeMs, now = Date.now(), maxBytes = 131072) {
  const cached = turnCache.get(file);
  let verdict;
  if (cached && cached.mtimeMs === mtimeMs) {
    verdict = cached.verdict;
  } else {
    verdict = "unknown";
    try {
      const fd = fs.openSync(file, "r");
      try {
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        const lines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          let entry;
          try {
            entry = JSON.parse(lines[i]);
          } catch {
            continue;
          }
          if (entry?.type !== "assistant" && entry?.type !== "user") continue;
          if (entry.type === "user") {
            verdict = "open";
          } else {
            const raw = entry.message?.content;
            const content = Array.isArray(raw)
              ? raw
              : typeof raw === "string" && raw.trim()
                ? [{ type: "text", text: raw }]
                : [];
            const hasText = content.some((block) => block?.type === "text");
            const hasTool = content.some((block) => block?.type === "tool_use");
            const reason = entry.message?.stop_reason ?? null;
            if (hasTool || reason === "tool_use" || !hasText) verdict = "open";
            else verdict = reason === "end_turn" ? "done" : "maybe";
          }
          break;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      verdict = "unknown";
    }
    turnCache.set(file, { mtimeMs, verdict });
  }
  if (verdict === "done") return true;
  return verdict === "maybe" && now - mtimeMs >= TURN_QUIET_MS;
}

// mtime capped by the last recorded event: a touched file never looks newer
// than what its agent actually did.
function effectiveActivityMs(file, mtimeMs) {
  const event = transcriptLastEventMs(file, mtimeMs);
  return event === null ? mtimeMs : Math.min(mtimeMs, event);
}

export function claudeProjectDir(repo, home = os.homedir()) {
  if (!repo) return null;
  return path.join(home, ".claude", "projects", path.resolve(String(repo)).replace(/[^A-Za-z0-9]/g, "-"));
}

export function recentClaudeSessions(dir, now = new Date(), options = {}) {
  if (!dir) return [];
  const recentMs = options.recentMs ?? ORCHESTRATOR_RECENT_MS;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const file = path.join(dir, entry.name);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (now.getTime() - mtimeMs > recentMs) continue;
    mtimeMs = effectiveActivityMs(file, mtimeMs);
    if (now.getTime() - mtimeMs > recentMs) continue;
    sessions.push({ id: entry.name.slice(0, -".jsonl".length), file, mtimeMs });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.slice(0, options.max ?? ORCHESTRATOR_MAX_SESSIONS);
}

// The model and effort a session really runs with, read from the end of its
// transcript (assistant entries carry "model"; settings entries "effort").
// Null fields when the tail does not say; the card then falls back to config.
export function transcriptModel(file, maxBytes = 262144) {
  let text = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { model: null, effort: null };
  }
  const last = (regex) => {
    let found = null;
    for (const match of text.matchAll(regex)) found = match[1];
    return found;
  };
  return {
    model: last(/"model":"(claude-[^"]+)"/g),
    effort: last(/"effort":"([a-z]+)"/g)
  };
}

// Subagents a Claude Code session delegated work to: each one has its own
// transcript in <session>/subagents/agent-<id>.jsonl plus a .meta.json with
// its description, type and requested model. Recent ones come first.
export function recentClaudeSubagents(dir, now = new Date(), options = {}) {
  if (!dir) return [];
  const recentMs = options.recentMs ?? ORCHESTRATOR_RECENT_MS;
  let sessions;
  try {
    sessions = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const found = [];
  for (const session of sessions) {
    const subDir = path.join(dir, session.name, "subagents");
    let files;
    try {
      files = fs.readdirSync(subDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(subDir, name);
      let mtimeMs;
      let birthMs;
      try {
        const stat = fs.statSync(file);
        mtimeMs = stat.mtimeMs;
        birthMs = stat.birthtimeMs || stat.mtimeMs;
      } catch {
        continue;
      }
      if (now.getTime() - mtimeMs > recentMs) continue;
      mtimeMs = effectiveActivityMs(file, mtimeMs);
      if (now.getTime() - mtimeMs > recentMs) continue;
      const id = name.slice(0, -".jsonl".length).replace(/^agent-/, "");
      const meta = readJson(path.join(subDir, `${name.slice(0, -".jsonl".length)}.meta.json`)) ?? {};
      found.push({ id, file, mtimeMs, birthMs, meta });
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, options.maxSubagents ?? 12);
}

// -- OpenCode sessions ------------------------------------------------------
// The shared OpenCode server lists every session with its folder, so the runs
// an orchestrator launches by hand ("opencode run --dir <repo>") can be shown
// without a kit track. A snapshot refreshes the per-repo cache (briefly cached
// itself); withOrchestratorTracks reads it synchronously. Turn it off with
// "opencodeDiscovery": false; the server defaults to 127.0.0.1:4096 and can be
// set with "opencodeServer": { "host", "port" }.
const OPENCODE_RECENT_MS = 60 * 60000;
const OPENCODE_WORKING_MS = 3 * 60000;
const OPENCODE_REFRESH_MS = 4000;
const openCodeCache = new Map();

function normalizeFolder(value) {
  return path.resolve(String(value ?? "")).replace(/[\\/]+$/, "").toLowerCase();
}

export function openCodeServer(config) {
  return {
    host: config?.opencodeServer?.host ?? "127.0.0.1",
    port: Number(config?.opencodeServer?.port) || 4096
  };
}

export async function refreshOpenCodeSessions(config, project, now = Date.now()) {
  if (config?.opencodeDiscovery === false || !project?.repo) return;
  const key = normalizeFolder(project.repo);
  const cached = openCodeCache.get(key);
  if (cached && now - cached.at < OPENCODE_REFRESH_MS) return;
  const server = openCodeServer(config);
  const url = `http://${server.host}:${server.port}/session?directory=${encodeURIComponent(project.repo)}`;
  let sessions = [];
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const body = response.ok ? await response.json() : [];
    sessions = Array.isArray(body) ? body : [];
  } catch {
    sessions = [];
  }
  openCodeCache.set(key, { at: now, sessions });
}

export function openCodeSessionTracks(sessions, project, kit, now = new Date()) {
  const wanted = normalizeFolder(project?.repo);
  const known = (kit?.tracks ?? []).map((track) => String(track?.name ?? "").toLowerCase()).filter(Boolean);
  const seenTitles = new Set();
  const out = [];
  const list = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.id && normalizeFolder(session.directory) === wanted)
    .sort((a, b) => (b?.time?.updated ?? 0) - (a?.time?.updated ?? 0));
  for (const session of list) {
    const updated = Number(session?.time?.updated);
    if (!Number.isFinite(updated) || now.getTime() - updated > OPENCODE_RECENT_MS) continue;
    const title = String(session.title ?? "").trim();
    const words = title.toLowerCase().split(/\s+/);
    if (known.some((name) => words.includes(name))) continue;
    const dedupe = title || session.id;
    if (seenTitles.has(dedupe)) continue;
    seenTitles.add(dedupe);
    const working = now.getTime() - updated <= OPENCODE_WORKING_MS;
    out.push({
      name: `oc-${String(session.id).slice(-8)}`,
      engine: "opencode",
      title: title || "Sesión de OpenCode",
      label: "OpenCode",
      workdir: project.repo,
      sessionId: session.id,
      branch: "main",
      model: session.model?.id ? `${session.model.providerID ?? "opencode-go"}/${session.model.id}` : undefined,
      __state: working ? "working" : "done",
      __statusTime: new Date(updated).toISOString()
    });
    if (out.length >= 8) break;
  }
  return out;
}

// -- Codex runs --------------------------------------------------------------
// Codex keeps one rollout per session in <sessionsDir>/YYYY/MM/DD/. Its first
// line records the working folder, so a run launched by hand ("codex exec -C
// <folder>") belongs to a project when that folder is the repo or one of the
// worktrees next to it (<repo>-worktrees\*). Turned off with
// "codexDiscovery": false.
const CODEX_RECENT_MS = 60 * 60000;
const CODEX_WORKING_MS = 3 * 60000;
// A Codex run that spawned sub-agents sits idle while it waits for them (a
// wait call lasts minutes), so an unfinished turn is "waiting", not done, for
// this long after its last event.
const CODEX_WAITING_MS = 20 * 60000;
// The first lines of a rollout carry the whole instruction set, so the head to
// read is big; the result is cached per file once complete.
const CODEX_HEAD_BYTES = 4 * 1024 * 1024;
const codexInfoCache = new Map();
const CODEX_TAIL_BYTES = 65536;
const CODEX_MAX_RUNS = 6;
const codexCache = new Map();

function codexDayFolders(sessionsDir, now) {
  const folders = [];
  for (const back of [0, 1]) {
    const day = new Date(now.getTime() - back * 86400000);
    const pad = (value) => String(value).padStart(2, "0");
    folders.push(path.join(sessionsDir, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate())));
  }
  return folders;
}

function codexRunInfo(file) {
  const known = codexInfoCache.get(file);
  if (known) return known;
  const head = readFileHead(file, CODEX_HEAD_BYTES);
  if (!head) return null;
  let cwd = null;
  let model = null;
  let effort = null;
  let title = "";
  let agentPath = null;
  let agentRole = null;
  let parentId = null;
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === "session_meta" && !cwd) {
      cwd = entry.payload?.cwd ?? null;
      agentPath = entry.payload?.agent_path ?? null;
      agentRole = entry.payload?.agent_role ?? null;
      parentId = entry.payload?.parent_thread_id ?? null;
    }
    if (entry?.type === "turn_context") {
      cwd = cwd ?? entry.payload?.cwd ?? null;
      model = model ?? entry.payload?.model ?? null;
      effort = effort ?? entry.payload?.effort ?? entry.payload?.reasoning_effort ?? null;
    }
    if (!title && entry?.type === "response_item" && entry.payload?.role === "user") {
      for (const part of entry.payload.content ?? []) {
        const text = String(part?.text ?? "").trim();
        if (!text || text.startsWith("# AGENTS.md") || text.startsWith("<")) continue;
        const first = text.split(/\r?\n/).map((piece) => piece.trim()).find(Boolean) ?? "";
        title = first.replace(/^#+\s*/, "").replace(/^(task|title):\s*/i, "").slice(0, 80);
        if (title) break;
      }
    }
  }
  // A sub-agent Codex spawned has no prompt of its own: name it by its role and
  // task name ("explorer: theme map").
  if (!title && agentPath) {
    const task = String(agentPath).split("/").filter(Boolean).pop() ?? "";
    title = `${agentRole ?? "agente"}: ${task.replace(/_/g, " ")}`.slice(0, 80);
  }
  const info = {
    cwd,
    model,
    effort,
    title,
    parentId,
    subTask: agentPath ? String(agentPath).split("/").filter(Boolean).pop()?.replace(/_/g, " ") ?? null : null,
    subRole: agentRole
  };
  if (cwd && model && title) codexInfoCache.set(file, info);
  return info;
}

// While Codex keeps a rollout open, Windows does not refresh its mtime and size,
// so the run is judged from the file tail itself: the last event timestamp and
// whether the turn already completed.
function codexTail(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, CODEX_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const text = buffer.toString("utf8");
      let last = null;
      for (const match of text.matchAll(/"timestamp":"([^"]+)"/g)) last = match[1];
      const lastMs = last ? new Date(last).getTime() : NaN;
      return {
        lastEventMs: Number.isFinite(lastMs) ? lastMs : null,
        finished: text.lastIndexOf('"type":"task_complete"') > text.lastIndexOf('"type":"task_started"')
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { lastEventMs: null, finished: false };
  }
}

export function recentCodexRuns(sessionsDir, project, now = new Date()) {
  if (!sessionsDir || !project?.repo) return [];
  const key = `${sessionsDir}|${normalizeFolder(project.repo)}`;
  const cached = codexCache.get(key);
  if (cached && now.getTime() - cached.at < 4000) return cached.runs;
  const wanted = normalizeFolder(project.repo);
  const worktrees = wanted + "-worktrees" + path.sep;
  const found = [];
  for (const folder of codexDayFolders(sessionsDir, now)) {
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const file = path.join(folder, name);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const tail = codexTail(file);
      const activityMs = Math.max(stat.mtimeMs, tail.lastEventMs ?? 0);
      if (now.getTime() - activityMs > CODEX_RECENT_MS) continue;
      const info = codexRunInfo(file);
      if (!info?.cwd) continue;
      const cwd = normalizeFolder(info.cwd);
      if (cwd !== wanted && !cwd.startsWith(worktrees)) continue;
      const id = name.slice(0, -".jsonl".length).split("-").slice(-5).join("-");
      found.push({ id, file, mtimeMs: activityMs, finished: tail.finished, ...info });
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // A sub-agent names the task of the run that spawned it, so the card reads as
  // "theme writer (worker) — <parent task>" and not as an orphan.
  const byId = new Map(found.map((run) => [run.id, run]));
  for (const run of found) {
    const parent = run.parentId ? byId.get(run.parentId) : null;
    if (parent?.title && run.subTask) run.title = `${run.subTask} (${run.subRole ?? "agente"}) — ${parent.title}`.slice(0, 120);
  }
  const runs = found.slice(0, CODEX_MAX_RUNS);
  codexCache.set(key, { at: now.getTime(), runs });
  return runs;
}

export function codexRunTracks(runs, project, now = new Date()) {
  return (runs ?? []).map((run) => {
    const quiet = now.getTime() - run.mtimeMs;
    const state = run.finished
      ? "done"
      : quiet <= CODEX_WORKING_MS
        ? "working"
        : quiet <= CODEX_WAITING_MS
          ? "waiting"
          : "done";
    return {
      name: `cx-${String(run.id).slice(0, 8)}`,
      engine: "codex",
      title: run.title || "Sesión de Codex",
      label: "Codex",
      workdir: project.repo,
      activityFile: run.file,
      branch: "main",
      discoveredModel: run.model ?? undefined,
      discoveredEffort: run.effort ?? undefined,
      __state: state,
      __statusTime: new Date(run.mtimeMs).toISOString()
    };
  });
}

// -- Antigravity (agy) CLI runs ----------------------------------------------
// An orchestrator may launch Gemini through the Antigravity CLI directly,
// without registering a kit track; the monitor then has to discover the run by
// itself. Every conversation lives in
// ~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/
// transcript.jsonl and is appended live while it runs. A conversation belongs
// to the project when the head of its transcript mentions the project's repo
// or the kit's worktree parent.
export const AGY_BRAIN_RECENT_MS = 60 * 60000;
const AGY_BRAIN_WORKING_MS = 3 * 60000;
// A tool error is normally followed by the next step within seconds; this much
// silence after one means the run ended on it.
const AGY_ERROR_QUIET_MS = 25000;
const AGY_BRAIN_MAX_CONVERSATIONS = 6;
const AGY_BRAIN_HEAD_BYTES = 64 * 1024;

export function agyBrainDir(home = os.homedir()) {
  return path.join(home, ".gemini", "antigravity-cli", "brain");
}

// Recent conversations of the project, newest first: `{ id, file, mtimeMs,
// title }`. `brainDir` is explicit so the tests never touch the real folder.
// Only the head of each transcript is read, and the project's other runs keep
// their slot even when unrelated conversations are newer.
export function recentAgyConversations(brainDir, project, now = new Date(), options = {}) {
  if (!brainDir) return [];
  const recentMs = options.recentMs ?? AGY_BRAIN_RECENT_MS;
  const max = options.max ?? AGY_BRAIN_MAX_CONVERSATIONS;
  let entries;
  try {
    entries = fs.readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const transcripts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(brainDir, entry.name, ".system_generated", "logs", "transcript.jsonl");
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (now.getTime() - mtimeMs > recentMs) continue;
    transcripts.push({ id: entry.name, file, mtimeMs });
  }
  transcripts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const needles = projectPathNeedles(project, options);
  const found = [];
  for (const transcript of transcripts) {
    if (found.length >= max) break;
    const head = readFileHead(transcript.file, AGY_BRAIN_HEAD_BYTES);
    if (head === null || !mentionsAnyPath(head, needles)) continue;
    found.push({ ...transcript, title: agyConversationTitle(head), model: agyConversationModel(head) });
  }
  return found;
}

// A transcript JSON-encodes every Windows path it touches, so "\\" and "/"
// both appear; normalizing both sides folds the `file:///C:/...` form into the
// same text. Comparison is case-insensitive.
function normalizeMatchPath(value) {
  return String(value ?? "")
    .replace(/\\+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function projectPathNeedles(project, options) {
  return [project?.repo, project?.worktreeParent ?? options?.worktreeParent]
    .map(normalizeMatchPath)
    .filter(Boolean);
}

function mentionsAnyPath(text, needles) {
  if (needles.length === 0) return false;
  const haystack = normalizeMatchPath(text);
  return needles.some((needle) => haystack.includes(needle));
}

// The model a conversation runs with: agy records the selection in the first
// USER_INPUT ("The user changed setting `Model Selection` from None to
// Gemini 3.8 Flash (High)."). Null when the head does not say.
export function agyConversationModel(head) {
  const match = /Model Selection`? from [^\n]*? to ([^\n]+?)\.(?:\s|\\n|$)/.exec(String(head ?? ""));
  return match ? match[1].trim() : null;
}

// First line of the first USER_INPUT, without the wrapping XML tags and a
// leading `/plan`, capped so the card never overflows. Pure; exported for the
// sample check script.
export function agyConversationTitle(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== "USER_INPUT") continue;
    const content = String(entry.content ?? "");
    if (!content.trim()) continue;
    const lines = content
      .replace(/<[^>]*>/g, "\n")
      .split(/\r?\n/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    // A prompt can name its task with a "Title: ..." line, which wins over
    // the first line, which is often a rule ("You have NO terminal...").
    const named = lines.slice(0, 12).find((piece) => /^title:\s*\S/i.test(piece));
    const first = named ? named.replace(/^title:\s*/i, "") : (lines[0] ?? "");
    const title = first.replace(/^\/plan\b[ \t]*/i, "").trim();
    if (title) return title.slice(0, 80);
  }
  return "";
}

// True when the last entry of a brain transcript is a step with status ERROR.
export function agyLastStepFailed(file, maxBytes = 65536) {
  let text = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i])?.status === "ERROR";
    } catch {
      // The first line of the tail may be cut in half; keep walking up.
    }
  }
  return false;
}

function readFileHead(file, maxBytes) {
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, Math.max(1, Number(maxBytes) || 0));
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const bytes = fs.readSync(fd, buffer, read, length - read, read);
      if (bytes <= 0) break;
      read += bytes;
    }
    return buffer.toString("utf8", 0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Returns a copy of the kit with synthetic tracks in front of the kit's own
// tracks. The kit file is never written.
// - Subagents the project's Claude Code sessions delegated to: on by default
//   (`config.claudeSubagents === false` turns them off). This is the work the
//   orchestrator hands out, like the kit's builders.
// - The orchestrator sessions themselves: off by default, the user prefers
//   not to spend a card on them (`config.orchestratorSessions === true`).
// - Antigravity CLI conversations of the project: on by default
//   (`config.agyConversations === false` turns them off). The card's model is
//   left undefined on purpose: nothing can tell which model a brain folder
//   ran with, so the card reads "Antigravity" instead of guessing.
export function withOrchestratorTracks(kit, project, config = {}, now = new Date(), options = {}) {
  if (!project?.repo) return kit;
  const dir = claudeProjectDir(project.repo, options.home);
  const subagents = config?.claudeSubagents === false ? [] : recentClaudeSubagents(dir, now, options);
  const sessions = config?.orchestratorSessions === true ? recentClaudeSessions(dir, now, options) : [];
  const conversations =
    config?.agyConversations === false
      ? []
      : recentAgyConversations(
          options.brainDir ?? agyBrainDir(options.home),
          { repo: project.repo, worktreeParent: options.worktreeParent ?? resolveWorktreeParent(kit, project) },
          now,
          options
        );
  const openCodeTracks =
    config?.opencodeDiscovery === false
      ? []
      : openCodeSessionTracks(openCodeCache.get(normalizeFolder(project.repo))?.sessions, project, kit, now);
  const codexTracks =
    config?.codexDiscovery === false
      ? []
      : codexRunTracks(recentCodexRuns(expandVars(String(config?.codex?.sessionsDir ?? "~/.codex/sessions")), project, now), project, now);
  if (!sessions.length && !subagents.length && !conversations.length && !openCodeTracks.length && !codexTracks.length) return kit;
  const batchKeys = assignBatches(subagents);
  const subagentTracks = subagents.map((agent) => {
    const answered = transcriptTurnComplete(agent.file, agent.mtimeMs, now.getTime());
    const working = !answered && now.getTime() - agent.mtimeMs <= ORCHESTRATOR_WORKING_MS;
    const real = transcriptModel(agent.file);
    const description = String(agent.meta.description ?? "").trim() || `subagente ${agent.id.slice(0, 8)}`;
    return {
      name: `sub-${agent.id.slice(0, 10)}`,
      engine: "claude-code",
      title: description,
      label: `Subagente Claude · ${agent.meta.agentType ?? "agente"}`,
      workdir: project.repo,
      activityFile: agent.file,
      branch: "main",
      model: real.model ?? agent.meta.model ?? undefined,
      effort: real.effort ?? undefined,
      // A subagent that stopped writing is finished; the board hides it after
      // cleanup.hideFinishedAfterMinutes like any other finished worker.
      __state: working ? "working" : "done",
      __statusTime: new Date(agent.mtimeMs).toISOString(),
      miniGroup: batchKeys.get(agent.id) ?? null
    };
  });
  const tracks = sessions.map((session) => {
    const answered = transcriptTurnComplete(session.file, session.mtimeMs, now.getTime());
    const working = !answered && now.getTime() - session.mtimeMs <= ORCHESTRATOR_WORKING_MS;
    const real = transcriptModel(session.file);
    return {
      name: `${ORCHESTRATOR_TRACK_PREFIX}${session.id.slice(0, 8)}`,
      engine: "claude-code",
      title: `Orquestador Claude Code · sesión ${session.id.slice(0, 8)}`,
      label: "Orquestador Claude Code",
      workdir: project.repo,
      activityFile: session.file,
      branch: "main",
      model: real.model ?? config?.orchestrator?.model,
      effort: real.effort ?? config?.orchestrator?.effort,
      __state: working ? "working" : answered ? "done" : "waiting",
      __statusTime: new Date(session.mtimeMs).toISOString()
    };
  });
  const agyTracks = conversations.map((conversation) => {
    // No status file exists for a discovered run, so a transcript that stopped
    // growing reads as finished and ages out like any other done card.
    const quietMs = now.getTime() - conversation.mtimeMs;
    const working = quietMs <= AGY_BRAIN_WORKING_MS;
    // A run whose last step failed and that then went quiet was cut short
    // (for example a denied command): show it as stopped, not as working.
    const failed = quietMs > AGY_ERROR_QUIET_MS && agyLastStepFailed(conversation.file);
    return {
      name: `agy-${conversation.id.slice(0, 8)}`,
      engine: "antigravity",
      title: conversation.title,
      label: "Gemini · Antigravity",
      // Never fall back to the orchestrator's model: an unknown one reads "Antigravity".
      model: conversation.model ?? "Antigravity",
      workdir: project.repo,
      activityFile: conversation.file,
      activityFormat: "brain",
      __state: failed ? "error" : working ? "working" : "done",
      __statusTime: new Date(conversation.mtimeMs).toISOString()
    };
  });
  return {
    ...(kit ?? {}),
    server: kit?.server ?? (openCodeTracks.length ? openCodeServer(config) : undefined),
    tracks: [...subagentTracks, ...tracks, ...agyTracks, ...openCodeTracks, ...codexTracks, ...(kit?.tracks ?? [])]
  };
}

// The kit's worktree parent resolved like buildSnapshot does (against the kit
// file's folder, with %VARS% expanded), for the transcript path match.
function resolveWorktreeParent(kit, project) {
  if (!kit?.worktreeParent) return null;
  const base = project?.kitConfig ? path.dirname(project.kitConfig) : null;
  return base ? path.resolve(base, expandVars(String(kit.worktreeParent))) : String(kit.worktreeParent);
}

// How many workers build at once. Each one costs a few OpenCode HTTP calls, so
// a big project stays responsive without opening one connection per agent.
export const BUILD_WORKERS_CONCURRENCY = 8;

export async function buildWorkers(ctx) {
  // Resolve the visible tracks first (pure and synchronous), keeping their
  // order. Then run the slow per-worker reads with bounded concurrency and
  // return the results in that same order.
  const picked = [];
  const renderedGroups = new Set();
  for (const track of ctx.kit?.tracks ?? []) {
    if (!track) continue;
    // board: false hides a track, except while it is actually running: work
    // the orchestrator hands out must show even if nobody flipped the flag.
    if (track.board === false && !isRunningNow(track, ctx)) continue;
    let chosen = track;
    if (track.group) {
      if (renderedGroups.has(track.group)) continue;
      renderedGroups.add(track.group);
      chosen = pickGroup(ctx.kit, ctx.kitDir, track.group);
      if (!chosen || chosen.board === false) continue;
    }
    picked.push(chosen);
  }
  return mapLimit(picked, BUILD_WORKERS_CONCURRENCY, (track) => buildWorker(track, ctx));
}

// Runs `worker` over `items` with at most `limit` in flight, returning the
// results in the original order. A small local helper: no new dependency.
export async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let next = 0;
  const run = async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await worker(list[index], index);
    }
  };
  const runners = [];
  for (let i = 0; i < size; i += 1) runners.push(run());
  await Promise.all(runners);
  return results;
}

const RUNNING_FRESH_MS = 10 * 60000;

function isRunningNow(track, ctx) {
  if (!ctx.kitDir || track.group) return false;
  const status = readJson(path.join(ctx.kitDir, `status-${String(track.name ?? "")}.json`));
  if (status?.state !== "running") return false;
  const time = new Date(status.time).getTime();
  return Number.isFinite(time) && ctx.now.getTime() - time <= RUNNING_FRESH_MS;
}

// cleanup.hideFinishedAfterMinutes: when it holds a positive number, a card
// whose state is done or error and whose status time is older than that many
// minutes leaves the board but stays in hiddenWorkers, same shape as workers,
// so the page can show it again on demand. Working, waiting and stale cards
// never hide, and neither does a card without a valid status time. 0 or a
// missing key keeps the whole board, so the default behavior is unchanged.
export function hideFinishedWorkers(workers, config, now = new Date()) {
  const list = Array.isArray(workers) ? workers : [];
  const thresholdMinutes = Number(config?.cleanup?.hideFinishedAfterMinutes);
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) {
    return { workers: list, hiddenFinished: 0, hiddenWorkers: [] };
  }
  const visible = [];
  const hidden = [];
  const batchStays = new Set();
  for (const worker of list) {
    if (worker?.miniGroup && !isFinishedWorkerOlderThan(worker, thresholdMinutes, now)) batchStays.add(worker.miniGroup);
  }
  for (const worker of list) {
    const old = isFinishedWorkerOlderThan(worker, thresholdMinutes, now);
    const gone = worker?.miniGroup ? old && !batchStays.has(worker.miniGroup) : old;
    if (gone) hidden.push(worker);
    else visible.push(worker);
  }
  return { workers: visible, hiddenFinished: hidden.length, hiddenWorkers: hidden };
}

// Active cards keep their order; finished ones (done or error) go after them,
// the one that finished last first, so a fresh arrival heads the finished
// group and pushes the older ones down.
export function finishedByArrival(workers) {
  const list = Array.isArray(workers) ? workers : [];
  const isFinished = (w) => (w?.stateKind || w?.state) === "done" || (w?.stateKind || w?.state) === "error";
  const time = (w) => {
    const t = new Date(w?.statusTime ?? "").getTime();
    return Number.isFinite(t) ? t : -Infinity;
  };
  const active = list.filter((w) => !isFinished(w));
  const finished = list.filter(isFinished).sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    return ta === tb ? 0 : tb > ta ? 1 : -1;
  });
  return [...active, ...finished];
}

function isFinishedWorkerOlderThan(worker, thresholdMinutes, now) {
  const kind = worker?.stateKind || worker?.state;
  if (kind !== "done" && kind !== "error") return false;
  const time = new Date(worker?.statusTime ?? "").getTime();
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time > thresholdMinutes * 60000;
}

function pickGroup(kit, kitDir, group) {
  const members = (kit?.tracks ?? []).filter((track) => track?.group === group);
  if (members.length === 0) return null;
  let best = null;
  let bestTime = -Infinity;
  for (const member of members) {
    try {
      const stat = fs.statSync(path.join(kitDir, `status-${member.name}.json`));
      if (stat.mtimeMs > bestTime) {
        bestTime = stat.mtimeMs;
        best = member;
      }
    } catch {
      // No status file yet: keep looking.
    }
  }
  return best ?? members[0];
}

async function buildWorker(track, ctx) {
  const name = String(track.name ?? "");
  const workdir = resolveKitPath(track.workdir, ctx.kit, ctx.kitDir, ctx.config.__baseDir);
  const status = readJson(ctx.kitDir ? path.join(ctx.kitDir, `status-${name}.json`) : null);
  const engine = status?.engine || track.engine || "opencode";
  const adapter = ADAPTERS[ENGINE_TO_ADAPTER[engine] ?? "opencode"];
  const evidenceText = workdir && track.evidence ? readText(joinFrom(workdir, String(track.evidence))) : null;
  const fallbackRemaining = resolveRemainingText({
    status,
    evidenceText,
    prefix: track.prefix,
    etaEnd: track.etaEnd,
    now: ctx.now
  });
  const identity = trackIdentity(engine, track);
  const shortTitle = trackShortTitle(track);
  const branch = String(track.branch || name);
  // Optional JSONL transcript of a Claude subagent; other engines ignore it.
  const activityFile = resolveKitPath(track.activityFile, ctx.kit, ctx.kitDir, ctx.config.__baseDir);

  const [activity, lastCommit] = await Promise.all([
    adapter
      .activity({ name, workdir, activityFile, activityFormat: track.activityFormat, sessionId: track.sessionId }, ctx)
      .catch(() => ({ events: [], notice: "sin actividad visible" })),
    gitLastCommit(ctx.repo, branch)
  ]);

  // The agent's own todo list, when it has one, replaces the guessed etaEnd
  // with a measured remaining time; the status/evidence text stays as the
  // fallback for workers without a list.
  const progress = activity.progress ?? null;
  const lastStepAt = activity.lastStepAt ?? null;
  // Synthetic orchestrator tracks carry their state from the transcript age.
  // A real orphaned worker is mapped here: a cached hound verdict decides done
  // vs error; without a verdict it shows as error while the hound retries.
  const rawState = track.__state ?? workerState(status, ctx.now, ctx.pidAlive, ctx.pidStart);
  let state = rawState;
  let stateText = null;
  if (rawState === "orphaned") {
    stateText = ORPHAN_PENDING_TEXT;
    state = "error";
    const key = verdictKey(ctx.project?.id, name, status?.time);
    const verdict =
      ctx.hound?.verdictFor(key, async () =>
        houndRequest(ctx, {
          trackName: name,
          title: shortTitle,
          statusText: orphanStatusText(status),
          progress,
          steps: (activity.events ?? []).map((event) => `${event?.kind ?? ""}: ${event?.detail ?? ""}`.trim()),
          // The branch lives in the project repo; without one, the worker's own
          // workdir is the only place to look.
          commits: await gitCommitsSince(ctx.repo ?? workdir, ctx.repo ? branch : "HEAD", status?.time)
        })
      ) ?? null;
    if (verdict?.verdict === "done") state = "done";
    else if (verdict?.verdict === "error") state = "error";
    if (verdict) stateText = verdict.reason || null;
  }
  const stateKind = workerStateKind(state);
  // A finished or stopped worker keeps its status text ("terminado"): a todo
  // list it left half-ticked must not project a remaining time or a pace.
  const finished = stateKind === "done" || stateKind === "error";
  const { remainingText: remaining, pace } = finished
    ? { remainingText: fallbackRemaining, pace: null }
    : progressPace({
        progress,
        etaEnd: track.etaEnd,
        now: ctx.now,
        fallbackText: fallbackRemaining
      });

  return {
    name,
    identity,
    shortTitle,
    remaining,
    pace,
    progress,
    lastStepAt,
    idleText: stateKind === "working" ? idleText({ lastStepAt, now: ctx.now }) : null,
    title: builderTitle(identity, shortTitle, remaining),
    engine,
    state,
    stateKind,
    stateText: stateText ?? STATE_TEXT[state] ?? state,
    statusTime: track.__statusTime ?? status?.time ?? null,
    model: modelText(engine, ctx.kit, ctx.config, track),
    workdir,
    branch,
    lastCommit,
    activity,
    stepsSupported: typeof adapter.steps === "function",
    miniGroup: track.miniGroup ?? null
  };
}

// Computes the full typed steps of one worker for GET /api/steps. Returns null
// for an unknown worker; engines without a step mapper report unsupported. The
// kit/config resolution mirrors buildSnapshot, and the adapter supplies the
// raw records (OpenCode reads its server, Claude Code reads its activityFile).
export async function buildWorkerSteps(config, options = {}) {
  const project = options.project;
  const name = String(options.worker ?? "");
  if (!project || !name) return null;
  const now = options.now ?? new Date();
  const baseDir = config.__baseDir ?? process.cwd();

  let kit = null;
  let kitDir = null;
  if (project.kitConfig) {
    try {
      kit = JSON.parse(fs.readFileSync(project.kitConfig, "utf8"));
      kitDir = path.dirname(project.kitConfig);
    } catch {
      kit = null;
      kitDir = null;
    }
  }
  kit = withOrchestratorTracks(kit, project, config, now);
  const track = (kit?.tracks ?? []).find((entry) => entry && String(entry.name ?? "") === name);
  if (!track) return null;

  const repo =
    project.repo ??
    (kit?.repo ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.repo))) : null);
  const worktreeParent = kit?.worktreeParent
    ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.worktreeParent)))
    : null;
  const ctx = { config, kit, kitDir, repo, worktreeParent, now, project };
  const status = readJson(kitDir ? path.join(kitDir, `status-${name}.json`) : null);
  const engine = status?.engine || track.engine || "opencode";
  const adapter = ADAPTERS[ENGINE_TO_ADAPTER[engine] ?? "opencode"];
  if (typeof adapter.steps !== "function") {
    return { engine, steps: [], unsupported: true };
  }
  const workdir = resolveKitPath(track.workdir, kit, kitDir, baseDir);
  const activityFile = resolveKitPath(track.activityFile, kit, kitDir, baseDir);
  try {
    const result = await adapter.steps({ name, workdir, activityFile, activityFormat: track.activityFormat, sessionId: track.sessionId }, ctx);
    return { engine, steps: result?.steps ?? [], notice: result?.notice ?? null };
  } catch {
    return { engine, steps: [], notice: "sin pasos visibles" };
  }
}

// The folder a worker (kit track) runs in, resolved exactly like the cards do,
// for the file endpoints. Null for an unknown worker or a track without one.
// This is the only trust root those endpoints serve files from.
export function resolveWorkerWorkdir(config, options = {}) {
  const project = options.project;
  const name = String(options.worker ?? "");
  if (!project || !name) return null;
  let kit = null;
  if (project.kitConfig) {
    try {
      kit = JSON.parse(fs.readFileSync(project.kitConfig, "utf8"));
    } catch {
      kit = null;
    }
  }
  kit = withOrchestratorTracks(kit, project, config, options.now ?? new Date());
  const track = (kit?.tracks ?? []).find((entry) => entry && String(entry.name ?? "") === name);
  if (!track) return null;
  const baseDir = config?.__baseDir ?? process.cwd();
  return resolveKitPath(track.workdir, kit, project.kitConfig ? path.dirname(project.kitConfig) : null, baseDir);
}

// Clock skew allowed between the process start time and the status file time.
export const ORPHAN_START_TOLERANCE_MS = 2000;

// Red is only for real failures. A busy PC can delay the supervisor heartbeat
// (written every ~60 s) and a builder is briefly gone between two attempts:
// both show as amber instead of "detenido".
//
// `pidStart` returns the start time (ms) of a pid, or null when it is unknown.
// Windows reuses pids, so a live pid is only the runner when its process began
// at or before the status file was written. A live pid that started later, or a
// dead pid past the waiting window, means the runner is gone: the worker is
// "orphaned" and the hound decides its outcome.
export function workerState(status, now, pidAlive = isPidAlive, pidStart = () => null) {
  if (!status) return "error";
  const time = new Date(status.time).getTime();
  const ageMinutes = Number.isFinite(time) ? (now.getTime() - time) / 60000 : Infinity;
  // Exit code 5 = phase 1 done, parked until a referenced track finishes.
  if (status.state === "finished" && Number(status.exitCode) === 5) return "waiting";
  if (status.state === "finished") return Number(status.exitCode) === 0 ? "done" : "error";
  if (status.state === "waiting") return "waiting";
  if (status.state === "running") {
    const alive = pidAlive(status.pid);
    const startMs = Number.isFinite(time) ? pidStart(status.pid) : null;
    if (alive && Number.isFinite(startMs) && startMs > time + ORPHAN_START_TOLERANCE_MS) return "orphaned";
    if (alive && ageMinutes <= 5) return "working";
    if (alive) return "stale";
    if (ageMinutes <= 3) return "waiting";
    return "orphaned";
  }
  return "error";
}

export function modelText(engine, kit, config, track = {}) {
  const model = kit?.model ?? {};
  if (engine === "codex") {
    if (track?.discoveredModel) return modelLabel(String(track.discoveredModel), track.discoveredEffort ?? "");
    return modelLabel(model.codex, model.codexEffort);
  }
  if (engine === "claude-code") {
    // A Claude subagent card names its own model and effort; the orchestrator
    // model is only the fallback and an undeclared effort reads "por defecto".
    const claudeModel = String(track?.model || config?.orchestrator?.model || "Claude Code");
    const claudeEffort = String(track?.effort ?? "").trim() || "por defecto";
    return `${claudeModel} · ${claudeEffort}`;
  }
  if (engine === "antigravity") {
    return String(track?.model || config?.orchestrator?.model || "Antigravity");
  }
  // A track may pin its own OpenCode model; supervise.ps1 then drops the
  // variant unless the track sets one.
  if (track?.model) {
    return modelLabel(String(track.model).split("/").pop(), track.variant ?? "");
  }
  const short = String(model.opencode ?? "").split("/").pop();
  return modelLabel(short, model.variant);
}

// The status text handed to the hound: whatever the status file says about the
// run, falling back to its state ("running").
function orphanStatusText(status) {
  const message = String(status?.message ?? status?.detail ?? "").trim();
  return message || String(status?.state ?? "");
}

// One line per commit on the worker's branch since the status start time, for
// the hound's evidence. Bounded and timed out; an unknown repo or time is
// simply no evidence.
async function gitCommitsSince(repo, ref, sinceIso, limit = 20) {
  const since = sinceIso ? new Date(sinceIso) : null;
  if (!repo || !ref || !since || !Number.isFinite(since.getTime())) return [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repo, "log", "--oneline", `--since=${since.toISOString()}`, "-n", String(limit), ref],
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function gitLastCommit(repo, branch) {
  if (!repo || !branch) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repo, "log", "-1", "--format=%h|%cI|%s", branch],
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const parts = stdout.trim().split("|");
    if (parts.length < 3 || !parts[0]) return null;
    return { sha: parts[0], time: parts[1], subject: parts.slice(2).join("|") };
  } catch {
    return null;
  }
}

// Branch colour shown next to every worker model, from the very palette the
// git tree uses per lane. The index lets the page use the theme variables
// (`--branch-<index>`, -1 for the neutral token) and fall back to the hex.
// Exported for the tests.
export function applyBranchColors(workers, git) {
  const visible = new Set(git?.branches ?? []);
  for (const worker of workers ?? []) {
    const branch = String(worker?.branch ?? "");
    const known = Boolean(branch) && visible.has(branch);
    worker.branchColor = known ? branchColor(branch) : NEUTRAL_BRANCH_COLOR;
    worker.branchColorIndex = known ? branchColorIndex(branch) : -1;
  }
  return workers;
}

async function gitGraph(repo) {
  if (!repo) return { commits: [], branches: [], error: "sin repositorio configurado" };
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repo, "log", "--all", "--date-order", "--format=%H|%P|%D|%s|%ct", "-n", String(GIT_LOG_LIMIT)],
      { timeout: 10000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
    );
    let mainShas = null;
    for (const name of ["main", "master"]) {
      try {
        const chain = await execFileAsync(
          "git",
          ["-C", repo, "rev-list", "--first-parent", "-n", String(GIT_LOG_LIMIT), name],
          { timeout: 10000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
        );
        mainShas = new Set(chain.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        break;
      } catch {
        // No such branch: try the next name.
      }
    }
    const rows = assignLanes(parseGitLog(stdout), { mainShas });
    return { commits: rows, branches: collectBranches(rows), error: null };
  } catch {
    return { commits: [], branches: [], error: "no se pudo leer el árbol de git" };
  }
}

const PROCESS_START_TIMEOUT_MS = 8000;

// Start time (ms) of every pid, resolved in one PowerShell batch. `tasklist`
// carries no start time, so PowerShell is the cheap source. A pid with no start
// time (dead, not Windows, PowerShell error) is simply absent from the map and
// the caller trusts the pid as before. Exported for the tests.
export async function probeProcessStarts(pids) {
  const wanted = [
    ...new Set((Array.isArray(pids) ? pids : []).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))
  ];
  const starts = new Map();
  if (wanted.length === 0 || process.platform !== "win32") return starts;
  const script =
    "$ErrorActionPreference='SilentlyContinue'; " +
    `Get-Process -Id ${wanted.join(",")} | ForEach-Object { if ($_.StartTime) { "$($_.Id)|$($_.StartTime.ToUniversalTime().ToString('o'))" } }`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: PROCESS_START_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }
    );
    for (const line of stdout.split(/\r?\n/)) {
      const [id, iso] = line.trim().split("|");
      const pid = Number(id);
      const ms = new Date(iso).getTime();
      if (Number.isInteger(pid) && Number.isFinite(ms)) starts.set(pid, ms);
    }
  } catch {
    // No start times: the pid check alone decides, as before.
  }
  return starts;
}

// A per-snapshot `(pid) => startMs | null`, built from one batched probe of the
// pids every running status file names. Cached briefly through `memo`, so the
// overlapping polls of a slow project share the same probe.
async function processStartLookup(ctx) {
  if (!ctx.kitDir || !ctx.kit?.tracks) return () => null;
  const pids = [];
  for (const track of ctx.kit.tracks ?? []) {
    if (!track) continue;
    const status = readJson(path.join(ctx.kitDir, `status-${String(track.name ?? "")}.json`));
    if (status?.state === "running") pids.push(status.pid);
  }
  if (pids.length === 0) return () => null;
  const key = `pids:${pids.map(Number).sort((a, b) => a - b).join(",")}`;
  const starts = await memo(key, seconds(ctx.config.systemCacheSeconds, 10), () => probeProcessStarts(pids), new Map());
  return (pid) => {
    const ms = starts instanceof Map ? starts.get(Number(pid)) : undefined;
    return Number.isFinite(ms) ? ms : null;
  };
}

async function probePc() {
  const result = { cpu: null, ram: null, diskC: null, level: "ok", error: null };
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PC_SCRIPT],
      { timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024 }
    );
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    const [cpu, ram, disk] = line.split("|").map((value) => Number(value));
    if (Number.isFinite(cpu)) result.cpu = clampPct(cpu);
    if (Number.isFinite(ram) && ram >= 0) result.ram = clampPct(ram);
    if (Number.isFinite(disk) && disk >= 0) result.diskC = clampPct(disk);
  } catch {
    result.error = "no se pudo leer la carga del PC";
  }
  if (result.ram === null) {
    const total = os.totalmem();
    if (total > 0) result.ram = clampPct(Math.round((1 - os.freemem() / total) * 100));
  }
  const values = [result.cpu, result.ram, result.diskC].filter((value) => value !== null);
  result.level = values.some((value) => value >= 80)
    ? "crit"
    : values.some((value) => value >= 50)
      ? "warn"
      : "ok";
  return result;
}

// TTL cache with in-flight dedupe: concurrent callers of the same key share a
// single build instead of stacking. A build that fails returns the fallback to
// every caller but is never cached, so the next poll retries it.
export async function memo(key, ttlMs, producer, fallback) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        return { ok: true, value: await producer() };
      } catch {
        return { ok: false };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
  }
  const result = await pending;
  if (!result.ok) return fallback;
  cache.set(key, { at: Date.now(), value: result.value });
  return result.value;
}

function resolveKitPath(value, kit, kitDir, fallbackBase) {
  if (!value) return null;
  const withTokens = expandVars(String(value))
    .replace(/\{repo\}/g, kit?.repo ? String(kit.repo) : "")
    .replace(/\{worktreeParent\}/g, kit?.worktreeParent ? String(kit.worktreeParent) : "");
  return path.resolve(kitDir ?? fallbackBase, withTokens);
}

function joinFrom(base, child) {
  return path.isAbsolute(child) ? child : path.join(base, child);
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function expandVars(value) {
  return value
    .replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function seconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : fallback * 1000;
}

function clampPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}
