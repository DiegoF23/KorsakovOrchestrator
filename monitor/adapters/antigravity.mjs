import fs from "node:fs";
import { shortText } from "../lib/format.mjs";
import { readFileTail, parseJsonlTail } from "./claude-code.mjs";

export const AGY_TAIL_LINES = 5000;

export const id = "antigravity";
export const label = "Antigravity";

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
    return { events, notice: events.length ? null : "sin actividad visible" };
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }
}
