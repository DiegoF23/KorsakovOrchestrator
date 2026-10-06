// Codex adapter. Usage reads the rate_limits event of the newest session
// rollout files (~/.codex/sessions/YYYY/MM/DD), the same search board.ps1 does;
// activity reads the kit JSON log (log-<track>-*.jsonl), the same stream
// watch.ps1 maps. steps() reads that same log and keeps the full typed step
// stream: commands with their output and exit code, apply_patch hunks, MCP
// Engram calls and assistant messages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { firstSentence, shortPath, shortText } from "../lib/format.mjs";
import { buildProgress, withActivityProgress } from "../lib/progress.mjs";
import { capStep, commandStep, hashId, lastSteps, memoryAction, memoryStep, numberOrNull, stepStatus, toolTitle } from "../lib/steps.mjs";

export const id = "codex";
export const label = "Codex";
// Typed steps keep more history than the 15-line activity card, so the tail
// read is wider (still bounded: a huge log never loads whole).
export const STEPS_TAIL_MAX_BYTES = 512 * 1024;

const COMMAND_CALLS = new Set(["exec", "shell", "exec_command", "local_shell", "container.exec"]);
const RAW_ITEM_KINDS = new Set([
  "message",
  "customtoolcall",
  "customtoolcalloutput",
  "functioncall",
  "functioncalloutput",
  "reasoning",
  "commandexecution",
  "mcptoolcall",
  "agentmessage",
  "filechange",
  "collabtoolcall",
  "todolist",
  "error"
]);

// The rate_limits event carries its own timestamp in the rollout line, so the
// page can show the real age of the reading instead of guessing.
export function parseRateLimitsEvent(text) {
  if (!text) return null;
  const lines = String(text).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(lines[i]);
      const limits = event?.payload?.rate_limits ?? event?.payload?.info?.rate_limits;
      if (limits) return { limits, time: event.timestamp ?? null };
    } catch {
      // Partial line at the tail: keep scanning upwards.
    }
  }
  return null;
}

export function parseRateLimitsFromText(text) {
  return parseRateLimitsEvent(text)?.limits ?? null;
}

export function mapCodexUsage(limits, meta = {}) {
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
  const source = parseDate(meta.time) ?? (Number.isFinite(Number(meta.mtimeMs)) ? new Date(meta.mtimeMs) : null);
  const now = meta.now instanceof Date ? meta.now : new Date();
  const ageMinutes = source ? Math.max(0, (now.getTime() - source.getTime()) / 60000) : null;
  const withAge = {
    updatedAt: source ? source.toISOString() : null,
    ageMinutes,
    stale: false
  };
  if (!limits || !limits.primary) return { ...empty, ...withAge, error: "sin datos de Codex" };
  const five = Number(limits.primary.used_percent);
  const week = Number(limits.secondary?.used_percent);
  const extra = limits.rate_limit_reached_type
    ? "LÍMITE ALCANZADO"
    : five >= 85
      ? "pasa a OpenCode"
      : "";
  return {
    ...empty,
    ...withAge,
    available: true,
    fiveHour: { pct: Number.isFinite(five) ? five : 0, resetsAt: epochToIso(limits.primary.resets_at) },
    week: { pct: Number.isFinite(week) ? week : 0, resetsAt: epochToIso(limits.secondary?.resets_at) },
    extra,
    error: null
  };
}

export function mapCodexLogLine(event, ctx = {}) {
  const out = [];
  const item = event?.item;
  if (event?.type === "item.started" && item?.type === "command_execution") {
    out.push({ kind: "CMD", detail: shortText(stripPowershellWrapper(item.command)) });
  } else if (event?.type === "item.completed" && item?.type === "command_execution") {
    if (item.exit_code && item.exit_code !== 0) {
      out.push({ kind: "ERR", detail: `${shortText(item.command, 100)} (exit ${item.exit_code})` });
    }
  } else if (event?.type === "item.completed" && item?.type === "agent_message") {
    out.push({ kind: "MSG", detail: firstSentence(item.text) });
  } else if (event?.type === "item.completed" && item?.type === "file_change") {
    for (const change of item.changes ?? []) {
      out.push({ kind: "EDIT", detail: `${change.kind} ${shortPath(change.path, ctx.repo, ctx.worktreeParent)}` });
    }
  } else if (event?.type === "item.started" && item?.type === "collab_tool_call" && item.tool !== "wait") {
    out.push({ kind: "SUB", detail: `coordinando sub-agentes (${item.tool})` });
  } else if (event?.type === "tool_use") {
    const input = event.part?.state?.input ?? {};
    if (input.command) {
      out.push({ kind: "CMD", detail: shortText(String(input.command)) });
    } else if (input.filePath && ["write", "edit", "patch"].includes(event.part?.tool)) {
      out.push({
        kind: "EDIT",
        detail: shortText(shortPath(String(input.filePath), ctx.repo, ctx.worktreeParent), 200)
      });
    }
    if (event.part?.state?.status === "error") {
      out.push({
        kind: "ERR",
        detail: `${event.part.tool}: ${shortText(String(event.part.state.output ?? ""), 150)}`
      });
    }
  } else if (event?.type === "text") {
    out.push({ kind: "MSG", detail: firstSentence(event.part?.text) });
  }
  return out;
}

// Full, typed steps for the live view. The kit log carries `item.*` events from
// `codex exec --json`; a raw rollout carries the same calls as `response_item`
// records (custom_tool_call / custom_tool_call_output, paired by call_id) plus
// `event_msg` runtime events. A rollout repeats every call in both views, so
// when transcript items are present the runtime events are ignored: mapping
// both would duplicate every step. Pure; exported for tests.
export function mapCodexSteps(entries, ctx = {}) {
  const items = codexItems(entries);
  const outputs = new Map();
  for (const { item } of items) {
    const kind = itemKind(item);
    if (kind !== "customtoolcalloutput" && kind !== "functioncalloutput") continue;
    const callId = String(item.call_id ?? item.callId ?? "");
    if (callId) outputs.set(callId, item);
  }

  const steps = [];
  const positions = new Map();
  const push = (step) => {
    if (positions.has(step.id)) steps[positions.get(step.id)] = step;
    else {
      positions.set(step.id, steps.length);
      steps.push(step);
    }
  };

  let index = 0;
  for (const { item, time, event } of items) {
    const kind = itemKind(item);
    if (kind === "customtoolcalloutput" || kind === "functioncalloutput") continue;
    // The started event only opens the call; its completed twin carries the
    // exit code. Collab calls are the exception: watch.ps1 only sees them start.
    if (event === "item.started" && kind !== "collabtoolcall") continue;
    index += 1;
    if (kind === "commandexecution") {
      push(codexCommandStep(item, time, index));
    } else if (kind === "agentmessage") {
      push(codexMessageStep(item, time, index));
    } else if (kind === "filechange") {
      for (const step of codexFileChangeSteps(item, time, index, ctx)) push(step);
    } else if (kind === "mcptoolcall") {
      push(codexMcpStep(item, time, index));
    } else if (kind === "collabtoolcall") {
      push(codexCollabStep(item, time, index));
    } else if (kind === "customtoolcall" || kind === "functioncall") {
      for (const step of codexCallSteps(item, outputs, time, index, ctx)) push(step);
    } else if (kind === "message") {
      if (item.role === "assistant") push(codexMessageStep(item, time, index));
    }
  }
  return lastSteps(steps);
}

// Flattens the different envelopes into one item stream: `response_item` /
// `event_msg` rollout lines, `item.started` / `item.completed` log events and
// bare items.
function codexItems(entries) {
  const list = (entries ?? []).filter((entry) => entry && typeof entry === "object");
  const hasTranscript = list.some((entry) => entry.type === "response_item");
  const items = [];
  for (const entry of list) {
    const time = entry.timestamp ?? null;
    if (entry.type === "response_item" && entry.payload && typeof entry.payload === "object") {
      items.push({ item: entry.payload, time, event: null });
    } else if (entry.type === "event_msg" && entry.payload?.item && typeof entry.payload.item === "object") {
      if (!hasTranscript) items.push({ item: entry.payload.item, time, event: null });
    } else if ((entry.type === "item.started" || entry.type === "item.completed") && entry.item && typeof entry.item === "object") {
      items.push({ item: entry.item, time, event: entry.type });
    } else if (RAW_ITEM_KINDS.has(itemKind(entry))) {
      items.push({ item: entry, time, event: null });
    }
  }
  return items;
}

function itemKind(item) {
  return String(item?.type ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function codexCommandStep(item, time, index) {
  const command = codexCommandText(item.command);
  const output = codexOutput(item);
  const exitCode = numberOrNull(item.exit_code ?? item.exitCode);
  const failed = String(item.status ?? "").toLowerCase() === "failed" || (exitCode !== null && exitCode !== 0);
  return commandStep({
    id: item.id ? String(item.id) : `cmd-${hashId(index, command)}`,
    time,
    tool: "command_execution",
    status: failed ? "error" : stepStatus(item.status ?? "completed"),
    command,
    output,
    exitCode
  });
}

// Custom tool calls and classic function calls share the name-based dispatch:
// Engram memory, apply_patch hunks, shell/exec commands, anything else a tool.
function codexCallSteps(call, outputs, time, index, ctx) {
  const name = String(call.name ?? "");
  const callId = String(call.call_id ?? call.callId ?? "");
  const outputItem = callId ? outputs.get(callId) ?? null : null;
  const output = outputItem ? codexOutput(outputItem) : "";
  const exitCode = outputItem ? codexExitCode(outputItem, output) : null;
  const status = codexCallStatus(call, outputItem);
  const id = callId || `call-${hashId(index, name)}`;
  const input = codexCallInput(call);

  if (memoryAction(name)) {
    return [memoryStep({ id, time, tool: name, status, input: input.object ?? {}, output: output || null })];
  }
  if (isPatchCall(name, input.text)) {
    return codexPatchSteps({ id, time, tool: name, status, text: input.text, ctx });
  }
  if (COMMAND_CALLS.has(name.toLowerCase())) {
    const embedded = extractToolCalls(input.text);
    if (embedded.length > 0) {
      const single = embedded.length === 1;
      return embedded.map((inner, position) =>
        codexEmbeddedStep(inner, {
          id: `${id}-${position}`,
          time,
          status,
          output: single ? output : "",
          exitCode: single ? exitCode : null,
          ctx
        })
      );
    }
    return [
      commandStep({
        id,
        time,
        tool: name,
        status: commandStatus(status, exitCode),
        command: codexCommandText(input.object?.command ?? input.text),
        output,
        exitCode
      })
    ];
  }
  return [
    capStep({
      id,
      time,
      type: "tool",
      tool: name,
      status,
      title: toolTitle(name, input.object ?? {}),
      data: { name, params: input.object ?? input.text, result: output || null }
    })
  ];
}

// One step for each `tools.<name>({...})` call inside an `exec` program. A call
// with several embedded tools spreads the combined output only when it has just
// one, so no step claims output that belongs to another.
function codexEmbeddedStep(call, { id, time, status, output, exitCode, ctx }) {
  const name = call.name;
  if (memoryAction(name)) {
    return memoryStep({ id, time, tool: name, status, input: call.args ?? {}, output: null });
  }
  if (name === "exec_command" || name === "shell") {
    return commandStep({
      id,
      time,
      tool: name,
      status: commandStatus(status, exitCode),
      command: codexCommandText(call.args?.cmd ?? call.args?.command ?? ""),
      output,
      exitCode
    });
  }
  return capStep({
    id,
    time,
    type: "tool",
    tool: name,
    status,
    title: toolTitle(name, call.args ?? {}),
    data: { name, params: call.args ?? {}, result: output || null }
  });
}

function codexMcpStep(item, time, index) {
  const tool = String(item.tool ?? item.name ?? "");
  const server = String(item.server ?? "");
  const input = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
  const output = codexMcpOutput(item);
  const status = stepStatus(item.status);
  const id = item.id ? String(item.id) : `mcp-${hashId(index, server, tool)}`;
  if (memoryAction(tool)) return memoryStep({ id, time, tool, status, input, output: output || null });
  return capStep({
    id,
    time,
    type: "tool",
    tool,
    status,
    title: toolTitle(tool, input),
    data: { name: tool, server: server || null, params: input, result: output || null }
  });
}

function codexCollabStep(item, time, index) {
  const tool = String(item.tool ?? "collab");
  const input = item.prompt ? { prompt: item.prompt } : {};
  return capStep({
    id: item.id ? String(item.id) : `collab-${hashId(index, tool)}`,
    time,
    type: "tool",
    tool,
    status: stepStatus(item.status ?? "completed"),
    title: toolTitle(tool, input),
    data: { name: tool, params: input, result: null }
  });
}

// A file_change item carries the path and kind but never the diff; add becomes
// a write, update an edit and delete the same "borrado" tool line apply_patch
// uses, so the file map still sees the touch.
function codexFileChangeSteps(item, time, index, ctx) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const status = stepStatus(item.status ?? "completed");
  return changes.map((change, position) => {
    const filePath = String(change?.path ?? "");
    const kind = String(change?.kind ?? "").toLowerCase();
    const label = shortText(shortPath(filePath, ctx.repo, ctx.worktreeParent), 120);
    const id = `${item.id ? String(item.id) : `change-${hashId(index, filePath)}`}-${position}`;
    if (kind === "add") {
      return capStep({
        id,
        time,
        type: "write",
        tool: "file_change",
        status,
        ...(filePath ? { path: filePath } : {}),
        title: `escribir ${label}`,
        data: { content: "" }
      });
    }
    if (kind === "delete") {
      return capStep({
        id,
        time,
        type: "tool",
        tool: "file_change",
        status,
        ...(filePath ? { path: filePath } : {}),
        title: `borrado: ${label}`,
        data: { name: "delete", params: { path: filePath } }
      });
    }
    return capStep({
      id,
      time,
      type: "edit",
      tool: "file_change",
      status,
      ...(filePath ? { path: filePath } : {}),
      title: `editar ${label}`,
      data: { oldText: "", newText: "" }
    });
  });
}

// Parses the apply_patch DSL: Add File lines carry the whole content, Update
// File hunks split into removed/context (oldText) and added/context (newText),
// Delete File is path-only. Pure; exported for tests.
export function parseCodexPatch(text) {
  const files = [];
  let current = null;
  let hunk = null;
  const flushHunk = () => {
    if (hunk && current) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.startsWith("*** Add File: ")) {
      flushFile();
      current = { kind: "add", path: line.slice("*** Add File: ".length), lines: [] };
    } else if (line.startsWith("*** Update File: ")) {
      flushFile();
      current = { kind: "update", path: line.slice("*** Update File: ".length), hunks: [] };
    } else if (line.startsWith("*** Delete File: ")) {
      flushFile();
      current = { kind: "delete", path: line.slice("*** Delete File: ".length), lines: [] };
    } else if (line.startsWith("***")) {
      flushHunk();
    } else if (current?.kind === "add") {
      if (line.startsWith("+")) current.lines.push(line.slice(1));
    } else if (current?.kind === "update") {
      if (line.startsWith("@@")) {
        flushHunk();
        hunk = { old: [], new: [] };
      } else if (!hunk) {
        hunk = { old: [], new: [] };
      } else if (line.startsWith("+")) {
        hunk.new.push(line.slice(1));
      } else if (line.startsWith("-")) {
        hunk.old.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        hunk.old.push(line.slice(1));
        hunk.new.push(line.slice(1));
      }
    }
  }
  flushFile();
  return files;
}

function codexPatchSteps({ id, time, tool, status, text, ctx }) {
  return parseCodexPatch(text).map((file, position) => {
    const label = shortText(shortPath(file.path, ctx.repo, ctx.worktreeParent), 120);
    const stepId = `${id}-${position}`;
    if (file.kind === "add") {
      return capStep({
        id: stepId,
        time,
        type: "write",
        tool,
        status,
        ...(file.path ? { path: file.path } : {}),
        title: `escribir ${label}`,
        data: { content: file.lines.join("\n") }
      });
    }
    if (file.kind === "delete") {
      return capStep({
        id: stepId,
        time,
        type: "tool",
        tool,
        status,
        ...(file.path ? { path: file.path } : {}),
        title: `borrado: ${label}`,
        data: { name: tool, params: { path: file.path } }
      });
    }
    const oldText = file.hunks.flatMap((entry) => entry.old).join("\n");
    const newText = file.hunks.flatMap((entry) => entry.new).join("\n");
    return capStep({
      id: stepId,
      time,
      type: "edit",
      tool,
      status,
      ...(file.path ? { path: file.path } : {}),
      title: `editar ${label}`,
      data: { oldText, newText }
    });
  });
}

function codexMessageStep(item, time, index) {
  const text = messageText(item);
  return capStep({
    id: item.id ? String(item.id) : `msg-${hashId(index, "message")}`,
    time,
    type: "message",
    tool: "text",
    status: "done",
    title: firstSentence(text),
    data: { text }
  });
}

function messageText(item) {
  const content = item?.content ?? item?.text ?? "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "string" ? block : String(block?.text ?? "")))
    .filter(Boolean)
    .join("\n");
}

function codexCallInput(call) {
  const raw = call.input ?? call.arguments ?? "";
  if (typeof raw === "string") return { text: raw, object: parseCallObject(raw) };
  if (raw && typeof raw === "object") return { text: "", object: raw };
  return { text: "", object: null };
}

// Codex arguments are JSON, but an `exec` program is a JS snippet with bare
// object keys; quote them before the last JSON.parse attempt.
function parseCallObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // JavaScript object literal: keep going.
  }
  const end = matchingDelimiter(trimmed, 0, "{", "}");
  const slice = end >= 0 ? trimmed.slice(0, end + 1) : trimmed;
  try {
    return JSON.parse(quoteBareKeys(slice));
  } catch {
    return null;
  }
}

// `tools.exec_command({cmd:"...",max_output_tokens:2})` -> one entry per call.
function extractToolCalls(text) {
  const source = String(text ?? "");
  const calls = [];
  const pattern = /tools\.([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("(", match.index);
    const close = matchingDelimiter(source, open, "(", ")");
    if (close < 0) break;
    const inner = source.slice(open + 1, close).trim();
    calls.push({ name: match[1], args: parseCallObject(inner) ?? {} });
    pattern.lastIndex = close + 1;
  }
  return calls;
}

function matchingDelimiter(text, start, open, close) {
  let depth = 0;
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function quoteBareKeys(text) {
  let out = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[index + 1] ?? "";
        index += 1;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === "{" || char === ",") {
      out += char;
      const rest = text.slice(index + 1);
      const key = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(rest);
      if (key) {
        out += rest.slice(0, key.index) + `"${key[1]}":`;
        index += key[0].length;
      }
      continue;
    }
    out += char;
  }
  return out;
}

function isPatchCall(name, text) {
  if (/apply_patch/i.test(name)) return true;
  return /^\s*\*\*\* Begin Patch/m.test(text) || /\*\*\* (Add|Update|Delete) File:/.test(text);
}

function codexCallStatus(call, outputItem) {
  const raw = String(outputItem?.status ?? call.status ?? "");
  if (!outputItem && !/error|failed/i.test(raw)) return "running";
  return stepStatus(raw || "completed");
}

function commandStatus(status, exitCode) {
  if (status === "running") return "running";
  if (exitCode !== null && exitCode !== 0) return "error";
  return status === "error" ? "error" : "done";
}

function codexExitCode(item, output) {
  const direct = numberOrNull(item?.exit_code ?? item?.exitCode);
  if (direct !== null) return direct;
  const match = /process exited with code\s+(-?\d+)/i.exec(String(output ?? ""));
  return match ? Number(match[1]) : null;
}

function codexOutput(item) {
  const output = item?.aggregated_output ?? item?.formatted_output ?? item?.output;
  if (typeof output === "string" && output) return output;
  const parts = [item?.stdout, item?.stderr].filter((part) => typeof part === "string" && part);
  return parts.join("\n");
}

function codexMcpOutput(item) {
  if (item?.error?.message) return String(item.error.message);
  const result = item?.result ?? item?.output;
  if (typeof result === "string") return result;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .map((block) => (typeof block === "string" ? block : String(block?.text ?? "")))
    .filter(Boolean)
    .join("\n");
}

function codexCommandText(command) {
  if (Array.isArray(command)) return stripPowershellWrapper(command.join(" "));
  return stripPowershellWrapper(String(command ?? ""));
}

export async function usage(ctx = {}) {
  const root = expandHome(ctx.config?.codex?.sessionsDir) || path.join(os.homedir(), ".codex", "sessions");
  const now = ctx.now ?? new Date();
  const today = path.join(
    root,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );
  try {
    const files = fs
      .readdirSync(today)
      .filter((name) => /^rollout-.*\.jsonl$/.test(name))
      .map((name) => {
        const full = path.join(today, name);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 6);
    for (const file of files) {
      const found = parseRateLimitsEvent(readTail(file.full, 256 * 1024));
      if (found?.limits) {
        return mapCodexUsage(found.limits, { time: found.time, mtimeMs: file.mtimeMs, now });
      }
    }
    return mapCodexUsage(null);
  } catch {
    return mapCodexUsage(null);
  }
}

const PLAN_CALL_NAMES = new Set(["update_plan", "plan"]);

// The codex `update_plan` tool calls are the checklist the agent keeps: the
// latest call wins and the first one dates the planning. Both envelope shapes
// are accepted (rollout `response_item` and kit-log `item.*`, plus the plan
// call embedded in an `exec` program). The kit log carries no timestamps, so
// `options.fallbackTime` (the file mtime) dates those entries. Pure; exported
// for tests.
export function progressFromEntries(entries, options = {}) {
  const fallbackTime = toIsoOrNull(options.fallbackTime);
  let firstAt = null;
  let latest = null;
  let lastStepAt = null;
  for (const { item, time } of codexItems(entries)) {
    const at = toIsoOrNull(time) ?? fallbackTime;
    if (at && (!lastStepAt || at > lastStepAt)) lastStepAt = at;
    for (const todos of codexPlanTodosFromItem(item)) {
      if (!firstAt) firstAt = at;
      latest = { todos };
    }
  }
  return {
    progress: latest ? buildProgress({ todos: latest.todos, firstAt, lastStepAt }) : null,
    lastStepAt
  };
}

function codexPlanTodosFromItem(item) {
  const name = String(item?.name ?? item?.tool ?? "").toLowerCase();
  const inputs = [];
  if (COMMAND_CALLS.has(name)) {
    for (const call of extractToolCalls(codexCallInput(item).text)) {
      if (PLAN_CALL_NAMES.has(String(call.name ?? "").toLowerCase())) inputs.push(call.args ?? {});
    }
  } else if (PLAN_CALL_NAMES.has(name)) {
    const input = item?.input ?? item?.arguments ?? "";
    const args = input && typeof input === "object" ? input : parseCallObject(input);
    if (args) inputs.push(args);
  }
  const lists = [];
  for (const args of inputs) {
    const todos = codexPlanTodos(args);
    if (todos) lists.push(todos);
  }
  return lists;
}

// update_plan carries `plan` (the documented shape); `steps` and `todos` are
// accepted aliases, and a bare string step counts as pending.
function codexPlanTodos(args) {
  const list = ["plan", "steps", "todos"]
    .map((key) => (Array.isArray(args?.[key]) ? args[key] : null))
    .find(Boolean);
  if (!list) return null;
  return list.map((entry) => (entry && typeof entry === "object" ? entry : { step: entry, status: "pending" }));
}

export async function activity(worker, ctx = {}) {
  const kitDir = ctx.kitDir;
  if (!kitDir || !worker?.name) return { events: [], notice: "sin actividad visible" };
  try {
    const newest = newestLogFile(kitDir, worker.name);
    if (!newest) return { events: [], notice: "todavía no hay log" };
    const at = new Date(newest.mtimeMs).toISOString();
    const events = [];
    const entries = [];
    for (const line of readTail(newest.full, 128 * 1024).split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      entries.push(event);
      for (const mapped of mapCodexLogLine(event, ctx)) events.push({ time: at, ...mapped });
    }
    const { progress, lastStepAt } = progressFromEntries(entries, { fallbackTime: at });
    return withActivityProgress({ events: events.slice(-15), notice: events.length ? null : "sin eventos" }, progress, lastStepAt);
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }
}

// The same kit log feeds the typed steps, with a wider tail and without the
// 15-event trim of the activity card.
export async function steps(worker, ctx = {}) {
  const kitDir = ctx.kitDir;
  if (!kitDir || !worker?.name) return { steps: [], notice: "sin actividad visible" };
  try {
    const newest = newestLogFile(kitDir, worker.name);
    if (!newest) return { steps: [], notice: "todavía no hay log" };
    const entries = [];
    for (const line of readTail(newest.full, STEPS_TAIL_MAX_BYTES).split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // A partial line at the tail of a live log: skip it.
      }
    }
    const mapped = mapCodexSteps(entries, ctx);
    return { steps: mapped, notice: mapped.length ? null : "sin pasos visibles" };
  } catch {
    return { steps: [], notice: "sin actividad visible" };
  }
}

function newestLogFile(kitDir, name) {
  const candidates = fs
    .readdirSync(kitDir)
    .filter((file) => file.startsWith(`log-${name}-`) && file.endsWith(".jsonl"))
    .map((file) => {
      const full = path.join(kitDir, file);
      return { full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

function epochToIso(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoOrNull(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function stripPowershellWrapper(command) {
  let text = String(command ?? "");
  text = text.replace(/^\s*"?[^"]*?powershell(\.exe)?"?\s+(-NoProfile\s+)?-Command\s+/, "");
  text = text.replace(/^"+|"+$/g, "").replace(/\\"/g, '"');
  return text.trim();
}

function expandHome(value) {
  if (!value) return "";
  return String(value)
    .replace(/%USERPROFILE%/gi, os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
