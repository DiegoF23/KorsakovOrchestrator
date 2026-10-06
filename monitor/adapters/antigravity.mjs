import fs from "node:fs";
import { firstSentence, shortPath, shortText } from "../lib/format.mjs";
import { capStep, commandStep, hashId, lastSteps, memoryAction, memoryStep, numberOrNull, toolTitle } from "../lib/steps.mjs";
import { readFileTail, parseJsonlTail } from "./claude-code.mjs";

export const AGY_TAIL_LINES = 5000;
export const id = "antigravity";
export const label = "Antigravity";

// Parameter names verified against the agy stream samples (AbsolutePath,
// TargetFile, CommandLine, ServerName/ToolName/Arguments); the write/edit
// content fields (CodeContent, TargetContent/ReplacementContent and
// ReplacementChunks) are read with their camelCase twins.
const WRITE_CONTENT_KEYS = ["CodeContent", "codeContent", "Content", "content", "Code", "code"];
const EDIT_OLD_KEYS = ["TargetContent", "targetContent", "OldContent", "oldContent"];
const EDIT_NEW_KEYS = ["ReplacementContent", "replacementContent", "NewContent", "newContent", "CodeContent", "codeContent"];

export async function usage(ctx = {}) {
  return {
    id,
    label,
    available: false,
    fiveHour: null,
    week: null,
    extra: "sin datos de cuota locales",
    error: null,
    updatedAt: null,
    ageMinutes: null,
    stale: false
  };
}

const READ_TOOLS = new Set(["view_file", "read_file", "read_browser_page", "read_resource", "read_url_content", "grep_search"]);
const EDIT_TOOLS = new Set(["write_to_file", "create_file", "edit_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);

function getBaseName(absPath) {
  if (!absPath) return "";
  const parts = String(absPath).split(/[/\\]/);
  return parts[parts.length - 1];
}

function getFileTarget(params) {
  if (!params) return "";
  return params.AbsolutePath || params.TargetFile || params.file || params.path || "";
}

function isReadLike(name) {
  return READ_TOOLS.has(name) || name.includes("read") || name.includes("grep");
}

function isEditLike(name) {
  return EDIT_TOOLS.has(name) || name.includes("write") || name.includes("edit") || name.includes("replace") || name.includes("sed");
}

export function mapAgyEntries(entries, ctx = {}) {
  const events = [];
  let currentText = "";
  let currentStepIndex = null;
  const mtimeIso = ctx.mtimeMs ? new Date(ctx.mtimeMs).toISOString() : null;

  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") continue;

    if (entry.event === "step_update" && entry.step_update) {
      const update = entry.step_update;
      
      if (update.step_type === "tool") {
        if (update.state === "DONE" || update.state === "ERROR") {
          const name = update.tool_name || "";
          const info = update.tool_info || {};
          const params = info.parameters || {};

          if (update.state === "ERROR") {
            const errMsg = info.error?.message || "error";
            const firstLine = String(errMsg).split(/\r?\n/)[0];
            events.push({ time: null, kind: "ERR", detail: shortText(firstLine, 150) });
          } else if (name === "run_command") {
            const cmd = params.CommandLine || "";
            events.push({ time: null, kind: "CMD", detail: shortText(cmd, 200) });
          } else if (name === "call_mcp_tool") {
            const srv = params.ServerName || "";
            const t = params.ToolName || "";
            events.push({ time: null, kind: "MSG", detail: shortText(`mcp ${srv}/${t}`, 200) });
          } else if (isReadLike(name)) {
            const target = getBaseName(getFileTarget(params));
            events.push({ time: null, kind: "READ", detail: shortText(target || name, 200) });
          } else if (isEditLike(name)) {
            const target = getBaseName(getFileTarget(params));
            events.push({ time: null, kind: "EDIT", detail: shortText(target || name, 200) });
          } else {
            events.push({ time: null, kind: "MSG", detail: shortText(name, 200) });
          }
        }
      } else if (update.step_type === "agent_response") {
        if (update.step_index !== currentStepIndex) {
          currentText = "";
          currentStepIndex = update.step_index;
        }
        if (update.text_delta) {
          currentText += update.text_delta;
        }
        if (update.state === "DONE") {
          const lines = currentText.split(/\r?\n/).filter((line) => line.trim() !== "");
          const lastLine = lines.at(-1);
          if (lastLine) {
            events.push({ time: null, kind: "MSG", detail: shortText(lastLine, 200) });
          }
          currentText = "";
          currentStepIndex = null;
        }
      }
    } else if (entry.event === "result" && entry.result) {
      const res = entry.result;
      const tokens = res.usage?.total_tokens || 0;
      const denied = (res.denied_actions ?? []).map((a) => a?.action ?? String(a));

      // agy ends the turn on any soft-denied permission and still reports
      // SUCCESS with an empty response, so both cases surface as errors.
      if (denied.length > 0) {
        events.push({ time: null, kind: "ERR", detail: shortText(`permiso denegado: ${denied.join(", ")}`, 150) });
      } else if (res.status === "SUCCESS" && !String(res.response ?? "").trim()) {
        events.push({ time: null, kind: "ERR", detail: "terminó sin respuesta" });
      }

      events.push({ time: mtimeIso, kind: "DONE", detail: shortText(`${res.status} · tokens ${tokens}`, 200) });
    }
  }

  return events;
}

// Full, typed steps for the live view, from the same activityFile the card
// reads. Each tool call keeps one step, updated in place while it runs and
// completed on DONE (or ERROR); streamed agent_response deltas accumulate into
// a single message per step_index, so a long answer never floods the stream.
// Pure; exported for tests.
export function mapAntigravitySteps(entries, ctx = {}) {
  const steps = [];
  const positions = new Map();
  const pendingText = new Map();
  const push = (step) => {
    if (positions.has(step.id)) steps[positions.get(step.id)] = step;
    else {
      positions.set(step.id, steps.length);
      steps.push(step);
    }
  };

  let index = 0;
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const update = entry.event === "step_update" ? entry.step_update : null;
    if (!update || typeof update !== "object") continue;
    index += 1;
    if (update.step_type === "tool") {
      const step = antigravityToolStep(update, index, ctx);
      if (step) push(step);
    } else if (update.step_type === "agent_response") {
      const key = `${update.conversation_id ?? "stream"}:${update.step_index ?? index}`;
      const text = `${pendingText.get(key) ?? ""}${update.text_delta ?? ""}`;
      if (update.state === "DONE" || update.state === "ERROR") {
        pendingText.delete(key);
        const trimmed = text.trim();
        if (trimmed) push(antigravityMessageStep(key, trimmed, update.state));
      } else {
        pendingText.set(key, text);
      }
    }
  }
  return lastSteps(steps);
}

function antigravityToolStep(update, index, ctx) {
  const name = String(update.tool_name ?? "");
  const info = update.tool_info && typeof update.tool_info === "object" ? update.tool_info : {};
  const params = info.parameters && typeof info.parameters === "object" ? info.parameters : {};
  const state = String(update.state ?? "");
  const status = state === "ERROR" ? "error" : state === "DONE" ? "done" : "running";
  const id = antigravityId(update, "tool", index);
  const error = state === "ERROR" ? firstLine(info.error?.message) : "";
  const path = getFileTarget(params);
  const label = shortText(shortPath(path, ctx.repo, ctx.worktreeParent), 120);

  if (name === "run_command") {
    const exitCode = numberOrNull(info.exit_code ?? info.exitCode ?? params.ExitCode ?? params.exitCode);
    return commandStep({
      id,
      time: null,
      tool: name,
      status: exitCode !== null && exitCode !== 0 ? "error" : status,
      command: String(params.CommandLine ?? params.Command ?? params.command ?? ""),
      output: error || String(info.output ?? ""),
      exitCode
    });
  }
  if (name === "call_mcp_tool") return antigravityMcpStep(id, name, params, info, status, error);
  if (isReadLike(name)) {
    const query = String(params.Query ?? params.query ?? params.Pattern ?? params.pattern ?? "");
    return capStep({
      id,
      time: null,
      type: "read",
      tool: name,
      status,
      ...(path ? { path } : {}),
      title: query ? `buscar «${shortText(query, 100)}»${label ? ` en ${label}` : ""}` : `leer ${label}`,
      data: error ? { error } : {}
    });
  }
  if (isEditLike(name)) {
    if (/write|create/i.test(name)) {
      return capStep({
        id,
        time: null,
        type: "write",
        tool: name,
        status,
        ...(path ? { path } : {}),
        title: `escribir ${label}`,
        data: { content: firstText(params, WRITE_CONTENT_KEYS), ...(error ? { error } : {}) }
      });
    }
    const chunks = chunkEdits(params);
    if (chunks) {
      return capStep({
        id,
        time: null,
        type: "edit",
        tool: name,
        status,
        ...(path ? { path } : {}),
        title: `editar ${label} (${chunks.length} cambios)`,
        data: { edits: chunks, ...(error ? { error } : {}) }
      });
    }
    return capStep({
      id,
      time: null,
      type: "edit",
      tool: name,
      status,
      ...(path ? { path } : {}),
      title: `editar ${label}`,
      data: { oldText: firstText(params, EDIT_OLD_KEYS), newText: firstText(params, EDIT_NEW_KEYS), ...(error ? { error } : {}) }
    });
  }
  return capStep({
    id,
    time: null,
    type: "tool",
    tool: name,
    status,
    title: toolTitle(name, params),
    data: { name, params, result: error || info.output || null }
  });
}

function antigravityMcpStep(id, name, params, info, status, error) {
  const server = String(params.ServerName ?? "");
  const tool = String(params.ToolName ?? "");
  const args = params.Arguments && typeof params.Arguments === "object" ? params.Arguments : {};
  const output = error || (typeof info.output === "string" ? info.output : "");
  if (memoryAction(tool)) return memoryStep({ id, time: null, tool, status, input: args, output: output || null });
  const label = [server, tool].filter(Boolean).join("/") || name;
  return capStep({
    id,
    time: null,
    type: "tool",
    tool: label,
    status,
    title: label,
    data: { name: tool || label, server: server || null, params: args, result: output || null }
  });
}

function antigravityMessageStep(key, text, state) {
  return capStep({
    id: `agy-msg-${hashId(key)}`,
    time: null,
    type: "message",
    tool: "text",
    status: state === "ERROR" ? "error" : "done",
    title: firstSentence(text),
    data: { text }
  });
}

function antigravityId(update, kind, index) {
  return `agy-${kind}-${hashId(update.conversation_id ?? "stream", update.step_index ?? index)}`;
}

function chunkEdits(params) {
  const chunks = Array.isArray(params.ReplacementChunks)
    ? params.ReplacementChunks
    : Array.isArray(params.replacementChunks)
      ? params.replacementChunks
      : null;
  if (!chunks || chunks.length === 0) return null;
  return chunks.map((chunk) => ({
    oldText: firstText(chunk, EDIT_OLD_KEYS),
    newText: firstText(chunk, EDIT_NEW_KEYS)
  }));
}

function firstText(source, names) {
  for (const name of names) {
    if (typeof source?.[name] === "string") return source[name];
  }
  return "";
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/)[0];
}

// -- Brain transcripts -------------------------------------------------------
// Runs launched directly through the agy CLI leave no stream-json: the monitor
// discovers them from ~/.gemini/antigravity-cli/brain/<id>/.system_generated/
// logs/transcript.jsonl (see recentAgyConversations in lib/state.mjs) and the
// card passes activityFormat "brain" here. One line per step carrying
// step_index, created_at, error?, thinking?, content? and tool_calls, where
// every argument value is JSON-encoded ("\"C:\\\\dir\\\\file\"", "100").
const BRAIN_READ_TOOLS = new Set(["view_file", "list_dir", "grep_search", "read_file", "read_browser_page", "read_resource", "read_url_content"]);
const ARG_DECODE_MAX_DEPTH = 4;

function isBrainReadLike(name) {
  return BRAIN_READ_TOOLS.has(name) || isReadLike(name);
}

function decodeArgValue(value, depth = 0) {
  if (typeof value === "string") {
    const text = value.trim();
    if (depth < ARG_DECODE_MAX_DEPTH && text.length > 1 && /^["[{]/.test(text)) {
      try {
        return decodeArgValue(JSON.parse(text), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeArgValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decodeArgValue(item, depth + 1);
    return out;
  }
  return value;
}

function brainToolCalls(entry) {
  return Array.isArray(entry?.tool_calls)
    ? entry.tool_calls.filter((call) => call && typeof call === "object")
    : [];
}

function brainToolArgs(call) {
  return decodeArgValue(call?.args && typeof call.args === "object" ? call.args : {});
}

function isoTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A tool call's outcome, read from the GENERIC result line that follows it.
function brainOutcome(result) {
  if (!result) return { status: "running", output: null, exitCode: null };
  const exitCode = numberOrNull(result.exit_code ?? result.exitCode);
  if (result.error) return { status: "error", output: String(result.error), exitCode };
  const status = String(result.status ?? "").toUpperCase();
  return {
    status: status === "ERROR" ? "error" : "done",
    output: typeof result.content === "string" ? result.content : null,
    exitCode
  };
}

function brainEventForCall(name, params) {
  if (name === "run_command") {
    return { kind: "CMD", detail: shortText(String(params.CommandLine ?? params.Command ?? params.command ?? ""), 200) };
  }
  if (name === "call_mcp_tool") {
    const label = [String(params.ServerName ?? ""), String(params.ToolName ?? "")].filter(Boolean).join("/");
    return { kind: "MSG", detail: shortText(`mcp ${label || name}`, 200) };
  }
  const target = getFileTarget(params) || firstString(params, ["DirectoryPath", "directoryPath", "SearchPath", "searchPath"]);
  if (isBrainReadLike(name)) {
    const query = String(params.Query ?? params.query ?? params.Pattern ?? params.pattern ?? "");
    return { kind: "READ", detail: shortText(query || getBaseName(target) || name, 200) };
  }
  if (isEditLike(name)) {
    return { kind: "EDIT", detail: shortText(getBaseName(target) || name, 200) };
  }
  return { kind: "MSG", detail: shortText(name, 200) };
}

// One-line events for the card log, the brain twin of mapAgyEntries. Tool
// results (GENERIC lines) only feed the ERR and DONE lines: the tool call
// already produced its own event.
export function mapAgyBrainEntries(entries, ctx = {}) {
  const list = entries ?? [];
  const events = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!entry || typeof entry !== "object") continue;
    const time = isoTime(entry.created_at);
    if (entry.error) events.push({ time, kind: "ERR", detail: shortText(firstLine(entry.error), 150) });
    if (entry.type !== "PLANNER_RESPONSE") continue;
    for (const call of brainToolCalls(entry)) {
      events.push({ time, ...brainEventForCall(String(call.name ?? ""), brainToolArgs(call)) });
    }
    const text = String(entry.content ?? "");
    if (text.trim()) {
      // A model step that closes the transcript is the final answer.
      events.push(
        index === list.length - 1
          ? { time, kind: "DONE", detail: shortText(firstLine(text), 200) }
          : { time, kind: "MSG", detail: shortText(firstLine(text), 200) }
      );
    }
  }
  return events;
}

// Full typed steps for the live view from the same brain transcript, reusing
// the step types and helpers of the stream mapper. Ids come from step_index
// so polling keeps them stable.
export function mapAgyBrainSteps(entries, ctx = {}) {
  const list = entries ?? [];
  const steps = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!entry || typeof entry !== "object" || entry.type !== "PLANNER_RESPONSE") continue;
    const stepIndex = entry.step_index ?? index;
    const time = isoTime(entry.created_at);
    const outcome = brainOutcome(list[index + 1]?.type === "GENERIC" ? list[index + 1] : null);

    const thinking = String(entry.thinking ?? "");
    if (thinking.trim()) {
      steps.push(
        capStep({
          id: `agy-brain-${stepIndex}-think`,
          time,
          type: "thinking",
          tool: "thinking",
          status: "done",
          title: "pensando",
          data: { text: thinking, startedAt: null, endedAt: null }
        })
      );
    }
    const text = String(entry.content ?? "");
    if (text.trim()) {
      steps.push(
        capStep({
          id: `agy-brain-${stepIndex}-text`,
          time,
          type: "message",
          tool: "text",
          status: "done",
          title: firstSentence(text),
          data: { text }
        })
      );
    }
    brainToolCalls(entry).forEach((call, callIndex) => {
      steps.push(brainCallStep(call, `agy-brain-${stepIndex}-${callIndex}`, time, outcome, ctx));
    });
  }
  return lastSteps(steps);
}

function brainCallStep(call, id, time, outcome, ctx) {
  const name = String(call?.name ?? "");
  const params = brainToolArgs(call);
  const error = outcome.status === "error" ? String(outcome.output ?? "") : "";
  const path =
    getFileTarget(params) || firstString(params, ["DirectoryPath", "directoryPath", "SearchPath", "searchPath"]);
  const label = shortText(shortPath(path, ctx.repo, ctx.worktreeParent), 120);

  if (name === "run_command") {
    return commandStep({
      id,
      time,
      tool: name,
      status: outcome.status,
      command: String(params.CommandLine ?? params.Command ?? params.command ?? ""),
      output: outcome.output ?? "",
      exitCode: outcome.exitCode
    });
  }
  if (name === "call_mcp_tool") return brainMcpStep(id, time, name, params, outcome);
  if (isBrainReadLike(name)) {
    const query = String(params.Query ?? params.query ?? params.Pattern ?? params.pattern ?? "");
    return capStep({
      id,
      time,
      type: "read",
      tool: name,
      status: outcome.status,
      ...(path ? { path } : {}),
      title: query ? `buscar «${shortText(query, 100)}»${label ? ` en ${label}` : ""}` : `leer ${label}`,
      data: error ? { error } : {}
    });
  }
  if (isEditLike(name)) {
    if (/write|create/i.test(name)) {
      return capStep({
        id,
        time,
        type: "write",
        tool: name,
        status: outcome.status,
        ...(path ? { path } : {}),
        title: `escribir ${label}`,
        data: { content: firstText(params, WRITE_CONTENT_KEYS), ...(error ? { error } : {}) }
      });
    }
    const chunks = chunkEdits(params);
    if (chunks) {
      return capStep({
        id,
        time,
        type: "edit",
        tool: name,
        status: outcome.status,
        ...(path ? { path } : {}),
        title: `editar ${label} (${chunks.length} cambios)`,
        data: { edits: chunks, ...(error ? { error } : {}) }
      });
    }
    return capStep({
      id,
      time,
      type: "edit",
      tool: name,
      status: outcome.status,
      ...(path ? { path } : {}),
      title: `editar ${label}`,
      data: { oldText: firstText(params, EDIT_OLD_KEYS), newText: firstText(params, EDIT_NEW_KEYS), ...(error ? { error } : {}) }
    });
  }
  return capStep({
    id,
    time,
    type: "tool",
    tool: name,
    status: outcome.status,
    title: toolTitle(name, params),
    data: { name, params, result: outcome.output ?? null }
  });
}

function brainMcpStep(id, time, name, params, outcome) {
  const server = String(params.ServerName ?? "");
  const tool = String(params.ToolName ?? "");
  const args = params.Arguments && typeof params.Arguments === "object" ? params.Arguments : {};
  const output = outcome.output ?? "";
  if (memoryAction(tool)) return memoryStep({ id, time, tool, status: outcome.status, input: args, output: output || null });
  const label = [server, tool].filter(Boolean).join("/") || name;
  return capStep({
    id,
    time,
    type: "tool",
    tool: label,
    status: outcome.status,
    title: label,
    data: { name: tool || label, server: server || null, params: args, result: output || null }
  });
}

function firstString(source, names) {
  for (const name of names) {
    if (typeof source?.[name] === "string" && source[name]) return source[name];
  }
  return "";
}

export async function activity(worker, ctx = {}) {
  const file = worker?.activityFile;
  if (!file) return { events: [], notice: "sin actividad visible" };
  
  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }

  try {
    const text = readFileTail(file);
    // agy streams the final answer as hundreds of tiny text_delta lines, so a
    // 200-line tail would hold nothing but the answer; the byte cap still bounds it.
    const entries = parseJsonlTail(text, AGY_TAIL_LINES);
    const events =
      worker?.activityFormat === "brain"
        ? mapAgyBrainEntries(entries, { ...ctx, mtimeMs })
        : mapAgyEntries(entries, { ...ctx, mtimeMs });
    return { events, notice: events.length ? null : "sin actividad visible" };
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }
}

// The same activityFile feeds the typed steps of the live view.
export async function steps(worker, ctx = {}) {
  const file = worker?.activityFile;
  if (!file) return { steps: [], notice: "sin actividad visible" };
  try {
    const text = readFileTail(file);
    const entries = parseJsonlTail(text, AGY_TAIL_LINES);
    const mapped = worker?.activityFormat === "brain" ? mapAgyBrainSteps(entries, ctx) : mapAntigravitySteps(entries, ctx);
    return { steps: mapped, notice: mapped.length ? null : "sin pasos visibles" };
  } catch {
    return { steps: [], notice: "sin actividad visible" };
  }
}
