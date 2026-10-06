import fs from "node:fs";
import { firstSentence, shortPath, shortText } from "../lib/format.mjs";
import { withActivityProgress } from "../lib/progress.mjs";
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
    const events = mapAgyEntries(entries, { ...ctx, mtimeMs });
    // Antigravity keeps no todo list, but its file mtime still dates the
    // newest step, so the card can warn about a worker that stopped moving.
    // An unreadable or empty stream carries no step at all.
    const lastStepAt = entries.length ? new Date(mtimeMs).toISOString() : null;
    return withActivityProgress({ events, notice: events.length ? null : "sin actividad visible" }, null, lastStepAt);
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
    const mapped = mapAntigravitySteps(entries, ctx);
    return { steps: mapped, notice: mapped.length ? null : "sin pasos visibles" };
  } catch {
    return { steps: [], notice: "sin actividad visible" };
  }
}
