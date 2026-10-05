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
import { assignLanes, branchColor, collectBranches, NEUTRAL_BRANCH_COLOR, parseGitLog } from "./graph.mjs";
import { enrichSnapshot } from "./translate.mjs";

const execFileAsync = promisify(execFile);

const ADAPTERS = { claude, codex, opencode, antigravity };
const ENGINE_TO_ADAPTER = { "claude-code": "claude", codex: "codex", opencode: "opencode", antigravity: "antigravity" };
const STATE_TEXT = { working: "trabajando", done: "terminado", error: "detenido", waiting: "esperando", stale: "sin reporte reciente" };
// The git panel scrolls on its own, so it can afford the whole recent history.
export const GIT_LOG_LIMIT = 200;
const cache = new Map();

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

// Header data of the orchestrator: engine, model and effort as declared in
// fleet-monitor.config.json, plus the ready-to-show "model · effort" text.
export function orchestratorInfo(config) {
  const raw = config?.orchestrator ?? {};
  const model = raw.model ?? "";
  const effort = raw.effort ?? "";
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
  const notices = [];
  const baseDir = config.__baseDir ?? process.cwd();

  let kit = null;
  let kitDir = null;
  if (config.workers?.kitConfig) {
    try {
      kit = JSON.parse(fs.readFileSync(config.workers.kitConfig, "utf8"));
      kitDir = path.dirname(config.workers.kitConfig);
    } catch {
      notices.push(`No se pudo leer la configuración del kit: ${config.workers.kitConfig}`);
    }
  } else {
    notices.push("No hay una configuración de kit declarada.");
  }

  const repo =
    config.repo ??
    (kit?.repo ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.repo))) : null);
  const worktreeParent = kit?.worktreeParent
    ? path.resolve(kitDir ?? baseDir, expandVars(String(kit.worktreeParent)))
    : null;
  const ctx = { config, kit, kitDir, repo, worktreeParent, now };

  const usages = await usageSnapshot(ctx);
  const builtWorkers = await buildWorkers(ctx);
  const { workers, hiddenFinished, hiddenWorkers } = hideFinishedWorkers(builtWorkers, config, now);
  const pc = await memo("pc", seconds(config.systemCacheSeconds, 10), () => probePc(), {
    cpu: null,
    ram: null,
    diskC: null,
    level: "ok",
    error: "no se pudo leer la carga del PC"
  });
  const git = await memo(`git:${repo ?? ""}`, seconds(config.gitCacheSeconds, 10), () => gitGraph(repo), {
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
    orchestrator: orchestratorInfo(config),
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
  // background helper call at most; it never delays this snapshot.
  enrichSnapshot(snapshot, { kit, config, now });
  return snapshot;
}

async function usageSnapshot(ctx) {
  const ttl = seconds(ctx.config.usageCacheSeconds, 60);
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

export async function buildWorkers(ctx) {
  const out = [];
  const renderedGroups = new Set();
  for (const track of ctx.kit?.tracks ?? []) {
    if (!track || track.board === false) continue;
    let picked = track;
    if (track.group) {
      if (renderedGroups.has(track.group)) continue;
      renderedGroups.add(track.group);
      picked = pickGroup(ctx.kit, ctx.kitDir, track.group);
      if (!picked || picked.board === false) continue;
    }
    out.push(await buildWorker(picked, ctx));
  }
  return out;
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
  for (const worker of list) {
    if (isFinishedWorkerOlderThan(worker, thresholdMinutes, now)) hidden.push(worker);
    else visible.push(worker);
  }
  return { workers: visible, hiddenFinished: hidden.length, hiddenWorkers: hidden };
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
  const remaining = resolveRemainingText({
    status,
    evidenceText,
    prefix: track.prefix,
    etaEnd: track.etaEnd,
    now: ctx.now
  });
  const identity = trackIdentity(engine, track);
  const shortTitle = trackShortTitle(track);
  const state = workerState(status, ctx.now);
  const stateKind = workerStateKind(state);
  const branch = String(track.branch || name);
  // Optional JSONL transcript of a Claude subagent; other engines ignore it.
  const activityFile = resolveKitPath(track.activityFile, ctx.kit, ctx.kitDir, ctx.config.__baseDir);

  const [activity, lastCommit] = await Promise.all([
    adapter
      .activity({ name, workdir, activityFile }, ctx)
      .catch(() => ({ events: [], notice: "sin actividad visible" })),
    gitLastCommit(ctx.repo, branch)
  ]);

  return {
    name,
    identity,
    shortTitle,
    remaining,
    title: builderTitle(identity, shortTitle, remaining),
    engine,
    state,
    stateKind,
    stateText: STATE_TEXT[state] ?? state,
    statusTime: status?.time ?? null,
    model: modelText(engine, ctx.kit, ctx.config, track),
    workdir,
    branch,
    lastCommit,
    activity
  };
}

// Red is only for real failures. A busy PC can delay the supervisor heartbeat
// (written every ~60 s) and a builder is briefly gone between two attempts:
// both show as amber instead of "detenido".
export function workerState(status, now, pidAlive = isPidAlive) {
  if (!status) return "error";
  const time = new Date(status.time).getTime();
  const ageMinutes = Number.isFinite(time) ? (now.getTime() - time) / 60000 : Infinity;
  // Exit code 5 = phase 1 done, parked until a referenced track finishes.
  if (status.state === "finished" && Number(status.exitCode) === 5) return "waiting";
  if (status.state === "finished") return Number(status.exitCode) === 0 ? "done" : "error";
  if (status.state === "waiting") return "waiting";
  if (status.state === "running") {
    const alive = pidAlive(status.pid);
    if (alive && ageMinutes <= 5) return "working";
    if (alive) return "stale";
    if (ageMinutes <= 3) return "waiting";
  }
  return "error";
}

export function modelText(engine, kit, config, track = {}) {
  const model = kit?.model ?? {};
  if (engine === "codex") {
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
// git tree uses per lane. Exported for the tests.
export function applyBranchColors(workers, git) {
  const visible = new Set(git?.branches ?? []);
  for (const worker of workers ?? []) {
    const branch = String(worker?.branch ?? "");
    worker.branchColor = branch && visible.has(branch) ? branchColor(branch) : NEUTRAL_BRANCH_COLOR;
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
    const rows = assignLanes(parseGitLog(stdout));
    return { commits: rows, branches: collectBranches(rows), error: null };
  } catch {
    return { commits: [], branches: [], error: "no se pudo leer el árbol de git" };
  }
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

async function memo(key, ttlMs, producer, fallback) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  let value;
  try {
    value = await producer();
  } catch {
    value = fallback;
  }
  cache.set(key, { at: now, value });
  return value;
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
