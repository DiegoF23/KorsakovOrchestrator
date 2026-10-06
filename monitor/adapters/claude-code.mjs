// Claude Code adapter. Usage comes from the JSON file declared in the config
// (today tools/autopilot/claude-usage.json), written by the orchestrator from
// time to time. Its age is shown next to the bars and the bars dim after
// 30 minutes; values are never invented. Activity comes from the optional
// per-track `activityFile` (the subagent JSONL transcript): only the tail of
// the file is read and every damaged line is skipped, so a huge or malformed
// transcript can neither block the server nor crash it.
import fs from "node:fs";

import { firstSentence, shortPath, shortText } from "../lib/format.mjs";
import { capStep, commandStep, lastSteps, memoryAction, memoryStep, numberOrNull, toolTitle } from "../lib/steps.mjs";

export const id = "claude";
export const label = "Claude";
export const STALE_MINUTES = 30;
// Last lines of the transcript that feed the activity card, and the byte cap
// of the tail read: the whole file is never loaded.
export const TAIL_LINES = 200;
export const TAIL_MAX_BYTES = 512 * 1024;

const TOOL_KINDS = {
  bash: "CMD",
  read: "READ",
  grep: "READ",
  glob: "READ",
  edit: "EDIT",
  write: "EDIT",
  multiedit: "EDIT",
  notebookedit: "EDIT"
};

function parseTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapClaudeUsage(data, now = new Date(), options = {}) {
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
  if (!data || typeof data !== "object") return { ...empty, error: "sin datos de consumo" };

  let fiveHour = Number(data.fiveHour);
  let week = Number(data.weekly);
  if (!Number.isFinite(fiveHour)) fiveHour = 0;
  if (!Number.isFinite(week)) week = 0;

  let resetsAt = parseTime(data.resetsAt);
  if (resetsAt && now > resetsAt) {
    fiveHour = 0;
    resetsAt = null;
  }

  const mtimeMs = Number(options.mtimeMs);
  const source = parseTime(data.time) ?? (Number.isFinite(mtimeMs) ? new Date(mtimeMs) : null);
  const ageMinutes = source ? Math.max(0, (now.getTime() - source.getTime()) / 60000) : null;

  return {
    ...empty,
    available: true,
    fiveHour: { pct: fiveHour, resetsAt: resetsAt ? resetsAt.toISOString() : null },
    week: { pct: week, resetsAt: null },
    updatedAt: source ? source.toISOString() : null,
    ageMinutes,
    stale: ageMinutes !== null && ageMinutes > STALE_MINUTES,
    error: null
  };
}

export async function usage(ctx = {}) {
  const file = ctx?.config?.claude?.usageFile;
  if (!file) return mapClaudeUsage(null);
  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    mtimeMs = null;
  }
  try {
    return mapClaudeUsage(JSON.parse(fs.readFileSync(file, "utf8")), ctx.now ?? new Date(), { mtimeMs });
  } catch {
    return { ...mapClaudeUsage(null), error: "no se pudo leer claude-usage.json" };
  }
}

// Bounded tail read: seeks to the last maxBytes of the file and never loads
// more than that, however large the transcript is.
export function readFileTail(file, maxBytes = TAIL_MAX_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - Math.max(1, Number(maxBytes) || 0));
    const length = size - start;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const bytes = fs.readSync(fd, buffer, read, length - read, start + read);
      if (bytes <= 0) break;
      read += bytes;
    }
    return buffer.toString("utf8", 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

// Keeps the last `limit` non-empty lines and parses what it can: a line cut by
// the tail read or a damaged entry is ignored, never fatal.
export function parseJsonlTail(text, limit = TAIL_LINES) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const entries = [];
  for (const line of lines.slice(-Math.max(1, Number(limit) || 0))) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Malformed line: skip it.
    }
  }
  return entries;
}

// Maps transcript entries to the same normalized events the OpenCode adapter
// emits: tool calls, assistant messages and one closing token total.
export function mapClaudeEntries(entries, ctx = {}) {
  const events = [];
  const toolNames = new Map();
  let tokens = 0;
  let lastTime = null;

  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const time = entryTime(entry.timestamp);
    if (time) lastTime = time;

    const usage = message.usage;
    if (usage && typeof usage === "object") {
      tokens += number(usage.input_tokens) + number(usage.output_tokens);
    }

    const assistant = entry.type === "assistant" || message.role === "assistant";
    const content = message.content;
    if (typeof content === "string") {
      if (assistant && content.trim()) events.push({ time, kind: "MSG", detail: firstSentence(content) });
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text") {
        if (assistant && part.text) events.push({ time, kind: "MSG", detail: firstSentence(part.text) });
      } else if (part.type === "tool_use") {
        if (part.id) toolNames.set(String(part.id), String(part.name ?? ""));
        const kind = TOOL_KINDS[String(part.name ?? "").toLowerCase()];
        if (!kind) continue;
        const input = part.input ?? {};
        if (kind === "CMD") {
          const command = String(input.command ?? "");
          events.push(
            /git\s+commit/.test(command)
              ? { time, kind: "COMMIT", detail: shortText(command) }
              : { time, kind: "CMD", detail: shortText(command) }
          );
        } else {
          const ref = input.file_path ?? input.pattern ?? "";
          events.push({ time, kind, detail: shortText(shortPath(String(ref), ctx.repo, ctx.worktreeParent), 200) });
        }
      } else if (part.type === "tool_result" && part.is_error) {
        const name = toolNames.get(String(part.tool_use_id ?? "")) || "herramienta";
        const output = toolResultText(part);
        events.push({
          time,
          kind: "ERR",
          detail: output ? `${name}: ${shortText(output, 150)}` : `${name} falló`
        });
      }
    }
  }

  if (tokens > 0) {
    events.push({ time: lastTime, kind: "DONE", detail: `tokens ${tokens}` });
  }
  return events;
}

// Full, typed steps for the live view: every tool_use keeps its complete input
// and the matching tool_result its output (joined by tool_use_id). Pure;
// exported for tests. A tool_use without a result is still running.
export function mapClaudeSteps(entries, ctx = {}) {
  const results = new Map();
  for (const entry of entries ?? []) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "tool_result") {
        results.set(String(part.tool_use_id ?? ""), { part, toolUseResult: entry.toolUseResult ?? null });
      }
    }
  }

  const steps = [];
  let index = 0;
  for (const entry of entries ?? []) {
    const message = entry?.message;
    if (!message || typeof message !== "object") continue;
    const time = entryTime(entry.timestamp);
    const assistant = entry.type === "assistant" || message.role === "assistant";
    const content = message.content;
    if (typeof content === "string") {
      index += 1;
      if (assistant && content.trim()) steps.push(claudeTextStep(entry, index, time, content));
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      index += 1;
      if (!part || typeof part !== "object") continue;
      if (part.type === "text") {
        if (assistant && part.text) steps.push(claudeTextStep(entry, index, time, part.text));
      } else if (part.type === "thinking") {
        const thinking = typeof part.thinking === "string" ? part.thinking : "";
        if (assistant && thinking.trim()) steps.push(claudeThinkingStep(entry, index, time, thinking));
      } else if (part.type === "tool_use") {
        steps.push(claudeToolStep(part, results.get(String(part.id ?? "")) ?? null, time, index, ctx));
      }
    }
  }
  return lastSteps(steps);
}

function claudeTextStep(entry, index, time, text) {
  return capStep({
    id: `text-${entry.uuid ?? entry.timestamp ?? "entry"}-${index}`,
    time,
    type: "message",
    tool: "text",
    status: "done",
    title: firstSentence(text),
    data: { text }
  });
}

// A thinking block is always finished by the time it reaches the transcript
// and carries no timing of its own, so the viewer shows it without a duration.
// Empty or redacted blocks are skipped instead of leaving an empty step.
function claudeThinkingStep(entry, index, time, text) {
  return capStep({
    id: `think-${entry.uuid ?? entry.timestamp ?? "entry"}-${index}`,
    time,
    type: "thinking",
    tool: "thinking",
    status: "done",
    title: "pensando",
    data: { text, startedAt: null, endedAt: null }
  });
}

function claudeToolStep(part, result, time, index, ctx) {
  const tool = String(part.name ?? "");
  const input = part.input && typeof part.input === "object" ? part.input : {};
  const id = part.id ? String(part.id) : `${tool}-${index}`;
  const status = !result ? "running" : result.part.is_error ? "error" : "done";
  const output = result ? toolResultText(result.part) : "";
  if (memoryAction(tool)) {
    return memoryStep({ id, time, tool, status, input, output: output || null });
  }

  const name = tool.toLowerCase();
  const ref = input.file_path ?? input.filePath ?? input.path ?? null;
  const path = ref !== null && ref !== undefined && ref !== "" ? String(ref) : null;
  const label = shortText(shortPath(String(ref ?? ""), ctx.repo, ctx.worktreeParent), 120);

  if (name === "write") {
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
  if (name === "edit") {
    return capStep({
      id,
      time,
      type: "edit",
      tool,
      status,
      ...(path ? { path } : {}),
      title: `editar ${label}`,
      data: { oldText: input.old_string ?? "", newText: input.new_string ?? "" }
    });
  }
  if (name === "multiedit") {
    const edits = Array.isArray(input.edits)
      ? input.edits.map((edit) => ({ oldText: edit?.old_string ?? "", newText: edit?.new_string ?? "" }))
      : [];
    return capStep({
      id,
      time,
      type: "edit",
      tool,
      status,
      ...(path ? { path } : {}),
      title: `editar ${label} (${edits.length} cambios)`,
      data: { edits }
    });
  }
  if (name === "read" || name === "grep" || name === "glob") {
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
  if (name === "bash" || name === "powershell") {
    return commandStep({
      id,
      time,
      tool,
      status,
      command: input.command ?? "",
      output: result ? claudeCommandOutput(result) : "",
      exitCode: result ? claudeExitCode(result) : null
    });
  }
  return capStep({
    id,
    time,
    type: "tool",
    tool,
    status,
    title: toolTitle(tool, input),
    data: { name: tool, params: input, result: result ? output || result.toolUseResult || null : null }
  });
}

function claudeCommandOutput(result) {
  const text = toolResultText(result.part);
  if (text) return text;
  const extra = result.toolUseResult;
  return extra ? [extra.stdout, extra.stderr].filter(Boolean).join("\n") : "";
}

// Real transcripts carry the exit code on the entry's toolUseResult; older
// ones only leave it inside the result text ("Exit code 1").
function claudeExitCode(result) {
  const direct = numberOrNull(result.toolUseResult?.exitCode);
  if (direct !== null) return direct;
  const match = /exit code[:\s]+(-?\d+)/i.exec(toolResultText(result.part));
  return match ? Number(match[1]) : null;
}

export async function activity(worker, ctx = {}) {
  const file = worker?.activityFile;
  if (!file) return { events: [], notice: "sin actividad visible" };
  try {
    const events = mapClaudeEntries(parseJsonlTail(readFileTail(file)), ctx);
    return { events, notice: events.length ? null : "sin actividad visible" };
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }
}

// The same transcript tail feeds the typed steps of the live view.
export async function steps(worker, ctx = {}) {
  const file = worker?.activityFile;
  if (!file) return { steps: [], notice: "sin actividad visible" };
  try {
    const mapped = mapClaudeSteps(parseJsonlTail(readFileTail(file)), ctx);
    return { steps: mapped, notice: mapped.length ? null : "sin pasos visibles" };
  } catch {
    return { steps: [], notice: "sin actividad visible" };
  }
}

function entryTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toolResultText(part) {
  const content = part?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((block) => block?.type === "text" && block.text);
    return text ? String(text.text) : "";
  }
  return "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
