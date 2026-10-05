// Codex adapter. Usage reads the rate_limits event of the newest session
// rollout files (~/.codex/sessions/YYYY/MM/DD), the same search board.ps1 does;
// activity reads the kit JSON log (log-<track>-*.jsonl), the same stream
// watch.ps1 maps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { firstSentence, shortPath, shortText } from "../lib/format.mjs";

export const id = "codex";
export const label = "Codex";

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

export async function activity(worker, ctx = {}) {
  const kitDir = ctx.kitDir;
  if (!kitDir || !worker?.name) return { events: [], notice: "sin actividad visible" };
  try {
    const candidates = fs
      .readdirSync(kitDir)
      .filter((name) => name.startsWith(`log-${worker.name}-`) && name.endsWith(".jsonl"))
      .map((name) => {
        const full = path.join(kitDir, name);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates.length === 0) return { events: [], notice: "todavía no hay log" };
    const newest = candidates[0];
    const at = new Date(newest.mtimeMs).toISOString();
    const events = [];
    for (const line of readTail(newest.full, 128 * 1024).split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      for (const mapped of mapCodexLogLine(event, ctx)) events.push({ time: at, ...mapped });
    }
    return { events: events.slice(-15), notice: events.length ? null : "sin eventos" };
  } catch {
    return { events: [], notice: "sin actividad visible" };
  }
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
