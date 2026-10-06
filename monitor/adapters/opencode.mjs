// OpenCode adapter. Usage prefers the hand-written official snapshot
// (opencode-official.json) merged with the local estimate script, and falls
// back to the estimate alone, the same logic board.ps1 applies. Activity reads
// the shared OpenCode server sessions, the same stream watch-opencode.ps1
// follows (GET only, read-only).
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

import { firstSentence, shortPath, shortText } from "../lib/format.mjs";
import { buildProgress, withActivityProgress } from "../lib/progress.mjs";
import { capStep, commandStep, lastSteps, memoryAction, memoryStep, numberOrNull, stepStatus, toolTitle } from "../lib/steps.mjs";

const execFileAsync = promisify(execFile);

export const id = "opencode";
export const label = "OpenCode Go";

export function mapOpenCodeMessages(messages, ctx = {}) {
  const events = [];
  for (const message of messages ?? []) {
    const info = message?.info ?? {};
    const time = toIso(info.time?.completed ?? info.time?.created);
    for (const part of message?.parts ?? []) {
      if (!part || !part.type) continue;
      if (part.type === "tool") {
        const status = part.state?.status;
        if (status !== "completed" && status !== "error") continue;
        if (status === "error") {
          const output = part.state?.output;
          events.push({
            time,
            kind: "ERR",
            detail: output ? `${part.tool}: ${shortText(String(output), 150)}` : `${part.tool} falló`
          });
          continue;
        }
        const input = part.state?.input ?? {};
        if (part.tool === "bash") {
          const command = String(input.command ?? "");
          const exit = part.state?.metadata?.exit;
          if (/git\s+commit/.test(command) && (exit === undefined || exit === 0)) {
            events.push({ time, kind: "COMMIT", detail: shortText(command, 150) });
          } else {
            events.push({ time, kind: "CMD", detail: shortText(command) });
          }
        } else if (part.tool === "write" || part.tool === "edit") {
          events.push({
            time,
            kind: "EDIT",
            detail: shortText(shortPath(String(input.filePath ?? ""), ctx.repo, ctx.worktreeParent), 200)
          });
        } else if (["read", "grep", "glob"].includes(part.tool)) {
          const ref = input.filePath ?? input.pattern ?? "";
          events.push({
            time,
            kind: "READ",
            detail: shortText(shortPath(String(ref), ctx.repo, ctx.worktreeParent), 200)
          });
        }
      } else if (part.type === "patch") {
        const names = (part.files ?? []).map((file) => String(file).split(/[\\/]/).pop());
        events.push({ time, kind: "EDIT", detail: names.join(", ") });
      } else if (part.type === "text") {
        if (info.role === "assistant" && part.text) {
          events.push({ time, kind: "MSG", detail: firstSentence(part.text) });
        }
      } else if (part.type === "step-finish") {
        if (part.cost || part.tokens?.total) {
          events.push({
            time,
            kind: "DONE",
            detail: `costo $${round4(part.cost)}  -  tokens ${part.tokens.total}`
          });
        }
      }
    }
  }
  return events;
}

// Full, typed steps for the live view. Unlike mapOpenCodeMessages (the short
// activity lines the cards use), every tool output, edit diff and memory call
// is kept so a specialised viewer can replay it. Pure; exported for tests.
export function mapOpenCodeSteps(messages, ctx = {}) {
  const steps = [];
  let index = 0;
  for (const message of messages ?? []) {
    const info = message?.info ?? {};
    const messageMs = Number(info.time?.completed ?? info.time?.created);
    const time = toIso(messageMs);
    for (const part of message?.parts ?? []) {
      index += 1;
      if (!part || typeof part !== "object") continue;
      if (part.type === "tool") {
        steps.push(openCodeToolStep(part, time, index, ctx));
      } else if (part.type === "reasoning") {
        steps.push(openCodeThinkingStep(part, messageMs, index));
      } else if (part.type === "text" && info.role === "assistant" && part.text) {
        steps.push(
          capStep({
            id: part.id ?? `text-${index}`,
            time,
            type: "message",
            tool: "text",
            status: "done",
            title: firstSentence(part.text),
            data: { text: part.text }
          })
        );
      }
    }
  }
  return lastSteps(steps);
}

// A reasoning part: running while `time.end` is missing (the server sends the
// text only when the model stops thinking) and done afterwards. `startedAt` is
// kept in epoch ms so the viewer can run a live counter while it reasons.
function openCodeThinkingStep(part, messageMs, index) {
  const startedAt = msOrNull(part.time?.start);
  const endedAt = msOrNull(part.time?.end);
  return capStep({
    id: part.id ?? `reasoning-${index}`,
    time: toIso(startedAt ?? messageMs),
    type: "thinking",
    tool: "reasoning",
    status: endedAt ? "done" : "running",
    title: "pensando",
    data: { text: part.text ?? "", startedAt, endedAt }
  });
}

function openCodeToolStep(part, time, index, ctx) {
  const tool = String(part.tool ?? "");
  const state = part.state ?? {};
  const input = state.input ?? {};
  const status = stepStatus(state.status);
  const id = part.id ?? `${tool}-${index}`;
  if (memoryAction(tool)) {
    return memoryStep({ id, time, tool, status, input, output: state.output ?? null });
  }
  if (tool === "bash") {
    return commandStep({
      id,
      time,
      tool,
      status,
      command: input.command ?? "",
      output: state.output ?? "",
      exitCode: numberOrNull(state.metadata?.exit)
    });
  }
  const filePath = input.filePath ?? input.path ?? null;
  const path = filePath ? String(filePath) : null;
  const label = shortText(shortPath(String(filePath ?? ""), ctx.repo, ctx.worktreeParent), 120);
  if (tool === "write") {
    return capStep({
      id,
      time,
      type: "write",
      tool,
      status,
      ...(path ? { path } : {}),
      title: `escribir ${label}`,
      data: { content: input.content ?? "" }
    });
  }
  if (tool === "edit") {
    return capStep({
      id,
      time,
      type: "edit",
      tool,
      status,
      ...(path ? { path } : {}),
      title: `editar ${label}`,
      data: { oldText: input.oldString ?? "", newText: input.newString ?? "" }
    });
  }
  if (tool === "read" || tool === "grep" || tool === "glob") {
    const pattern = input.pattern ? String(input.pattern) : "";
    return capStep({
      id,
      time,
      type: "read",
      tool,
      status,
      ...(path ? { path } : {}),
      title: pattern ? `buscar «${shortText(pattern, 100)}»${label ? ` en ${label}` : ""}` : `leer ${label}`,
      data: {}
    });
  }
  return capStep({
    id,
    time,
    type: "tool",
    tool,
    status,
    title: toolTitle(tool, input),
    data: { name: tool, params: input, result: state.output ?? null }
  });
}

export function sumEstimatePct(rows) {
  const total = { fiveHour: 0, week: 0, month: 0 };
  for (const row of rows ?? []) {
    for (const key of Object.keys(total)) {
      const value = Number(row?.pct?.[key]);
      if (Number.isFinite(value)) total[key] += value;
    }
  }
  for (const key of Object.keys(total)) total[key] = clampPct(Math.round(total[key]));
  return total;
}

// Mirrors board.ps1: the console snapshot wins, the local spend since it was
// taken is added on top, and once the rolling window has reset only the spend
// after that reset counts.
export function mergeOfficialUsage({ official, deltas, resetDeltas = [], estimate = null, now = new Date() }) {
  const empty = {
    id,
    label,
    available: false,
    fiveHour: null,
    week: null,
    extra: "",
    error: null,
    updatedAt: null,
    ageMinutes: null,
    stale: false
  };
  if (!official) {
    if (!estimate) return { ...empty, error: "no se pudo leer el consumo" };
    return {
      ...empty,
      available: true,
      fiveHour: { pct: clampPct(estimate.fiveHour), resetsAt: null },
      week: { pct: clampPct(estimate.week), resetsAt: null },
      extra: warnText(estimate.fiveHour, estimate.week),
      error: null
    };
  }

  const resetAt = parseDate(official.rollingResetsAt);
  const rolled = resetAt !== null && now > resetAt;
  const summed = sumEstimatePct(deltas);
  const summedAfterReset = sumEstimatePct(resetDeltas);
  const rolling = rolled ? summedAfterReset.fiveHour : clampPct(Math.round(number(official.rolling) + summed.fiveHour));
  const weekly = clampPct(Math.round(number(official.weekly) + summed.week));
  const nextReset = rolled && resetAt ? new Date(resetAt.getTime() + 5 * 3600 * 1000) : resetAt;
  // Age of the official snapshot; the estimate-only mode has no snapshot time.
  const updated = parseDate(official.updatedAt);
  const ageMinutes = updated ? Math.max(0, (now.getTime() - updated.getTime()) / 60000) : null;

  return {
    ...empty,
    available: true,
    fiveHour: { pct: rolling, resetsAt: nextReset ? nextReset.toISOString() : null },
    week: { pct: weekly, resetsAt: null },
    extra: warnText(weekly, number(official.monthly)),
    error: null,
    updatedAt: updated ? updated.toISOString() : null,
    ageMinutes
  };
}

export async function usage(ctx = {}) {
  const config = ctx.config?.opencode ?? {};
  const now = ctx.now ?? new Date();

  let official = null;
  try {
    if (config.officialFile) official = JSON.parse(fs.readFileSync(config.officialFile, "utf8"));
  } catch {
    official = null;
  }

  let sinceMs = 0;
  try {
    if (config.accountFile) {
      const account = JSON.parse(fs.readFileSync(config.accountFile, "utf8"));
      const since = account?.since ? new Date(account.since).getTime() : NaN;
      if (Number.isFinite(since)) {
        sinceMs = since;
        if (official && new Date(official.updatedAt).getTime() < since) official = null;
      }
    }
  } catch {
    // No account switch file: no window restriction.
  }

  if (official) {
    const snapshotMs = new Date(official.updatedAt).getTime() || 0;
    const resetAt = parseDate(official.rollingResetsAt);
    const rolled = resetAt !== null && now > resetAt;
    const deltas = await runEstimate(config.estimateScript, snapshotMs, ctx);
    const resetDeltas = rolled ? await runEstimate(config.estimateScript, resetAt.getTime(), ctx) : [];
    return mergeOfficialUsage({ official, deltas: deltas ?? [], resetDeltas: resetDeltas ?? [], now });
  }

  const estimated = await runEstimate(config.estimateScript, sinceMs, ctx);
  return mergeOfficialUsage({
    official: null,
    estimate: estimated ? sumEstimatePct(estimated) : null,
    now
  });
}

// The session's `todowrite` tool calls are the checklist the agent keeps. The
// latest call wins; the first one dates the planning. Pure; exported for tests.
export function progressFromMessages(messages) {
  let firstAt = null;
  let latest = null;
  let lastStepAt = null;
  for (const message of messages ?? []) {
    const ms = Number(message?.info?.time?.completed ?? message?.info?.time?.created);
    const time = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
    if (time && (!lastStepAt || time > lastStepAt)) lastStepAt = time;
    for (const part of message?.parts ?? []) {
      if (part?.type !== "tool" || String(part.tool ?? "").toLowerCase() !== "todowrite") continue;
      const todos = part.state?.input?.todos;
      if (!Array.isArray(todos)) continue;
      if (!firstAt) firstAt = time;
      latest = { todos };
    }
  }
  return {
    progress: latest ? buildProgress({ todos: latest.todos, firstAt, lastStepAt }) : null,
    lastStepAt
  };
}

export async function activity(worker, ctx = {}) {
  try {
    const { messages, notice } = await fetchSessionMessages(worker, ctx);
    if (notice) return { events: [], notice };
    const events = mapOpenCodeMessages(messages, ctx).slice(-15);
    const { progress, lastStepAt } = progressFromMessages(messages);
    return withActivityProgress({ events, notice: events.length ? null : "sin eventos" }, progress, lastStepAt);
  } catch {
    return { events: [], notice: "sin sesión activa" };
  }
}

// The same messages feed the typed steps, without the 15-event trim.
export async function steps(worker, ctx = {}) {
  try {
    const { messages, notice } = await fetchSessionMessages(worker, ctx);
    if (notice) return { steps: [], notice };
    const mapped = mapOpenCodeSteps(messages, ctx);
    return { steps: mapped, notice: mapped.length ? null : "sin pasos visibles" };
  } catch {
    return { steps: [], notice: "sin sesión activa" };
  }
}

// Several builders can share one folder (two research tracks in the same
// worktree), so the folder alone does not identify a worker's session. The
// launchers title each session with the track name ("flota <track> attempt N"
// from supervise.ps1, "<track>" from oc-run.ps1): prefer the newest session
// whose title has the track name as a whole word, and fall back to the newest
// session of the folder only when no title matches.
export function pickSession(sessions, trackName) {
  const list = Array.isArray(sessions) ? sessions.filter((session) => session?.id) : [];
  const newest = (items) => [...items].sort((a, b) => (b?.time?.updated ?? 0) - (a?.time?.updated ?? 0))[0] ?? null;
  const name = String(trackName ?? "").trim().toLowerCase();
  if (name) {
    const titled = list.filter((session) =>
      String(session?.title ?? "").toLowerCase().split(/\s+/).includes(name)
    );
    if (titled.length) return newest(titled);
  }
  return newest(list);
}

// Picks the worker's session in its directory and returns its messages;
// `notice` explains why there is nothing to read, mirroring the activity card.
async function fetchSessionMessages(worker, ctx) {
  const host = ctx.kit?.server?.host ?? "127.0.0.1";
  const port = ctx.kit?.server?.port;
  if (!port) return { messages: null, notice: "sin actividad visible" };
  const base = `http://${host}:${port}`;
  const directory = worker?.workdir ?? "";
  const url = directory
    ? `${base}/session?directory=${encodeURIComponent(directory)}`
    : `${base}/session`;
  const sessions = await fetchJson(url, 5000);
  const wanted = normalizeDir(directory);
  const inDir = Array.isArray(sessions)
    ? wanted
      ? sessions.filter((session) => normalizeDir(session?.directory) === wanted)
      : sessions
    : [];
  const picked = pickSession(inDir, worker?.name);
  if (!picked?.id) return { messages: null, notice: "sin sesión activa" };
  const messages = await fetchJson(`${base}/session/${encodeURIComponent(picked.id)}/message`, 8000);
  return { messages, notice: null };
}

async function runEstimate(script, sinceMs, ctx) {
  if (!script) return null;
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, String(sinceMs ?? 0)], {
      timeout: 20000,
      windowsHide: true
    });
    const line = String(stdout).trim().split(/\r?\n/).pop();
    const parsed = JSON.parse(line);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalizeDir(value) {
  return String(value ?? "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function toIso(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : new Date().toISOString();
}

function msOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round4(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : 0;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function warnText(fiveHour, week) {
  return Number(fiveHour) >= 85 || Number(week) >= 85 ? "CERCA DEL LÍMITE" : "";
}
