// Status line for Claude Code: prints a short line and saves the subscription
// rate limits (5h / 7d) that Claude Code passes on stdin, so the fleet monitor
// can read them without any model request.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same file the fleet monitor reads, also written from Claude Desktop sessions.
const OUT = path.join(os.homedir(), ".claude", "quota", "claude-usage.json");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw.replace(/^﻿/, "") || "{}"); } catch { /* keep the line alive */ }

  // Diagnostic: record every invocation so we can tell "never runs" from
  // "runs without rate_limits".
  try {
    fs.writeFileSync(path.join(os.homedir(), ".claude", "statusline-last-input.json"),
      JSON.stringify({ at: new Date().toISOString(), keys: Object.keys(data), rate_limits: data.rate_limits ?? null }));
  } catch { /* ignore */ }

  const limits = data.rate_limits ?? {};
  const five = limits.five_hour;
  const week = limits.seven_day;
  const iso = (epoch) => (Number.isFinite(Number(epoch)) ? new Date(Number(epoch) * 1000).toISOString() : null);

  if (five || week) {
    const snapshot = {
      time: new Date().toISOString(),
      fiveHour: Math.round(Number(five?.used_percentage ?? 0)),
      weekly: Math.round(Number(week?.used_percentage ?? 0)),
      resetsAt: iso(five?.resets_at),
      weeklyResetsAt: iso(week?.resets_at),
      model: data.model?.id ?? null,
      cwd: data.workspace?.current_dir ?? data.cwd ?? null,
      sessionId: data.session_id ?? null
    };
    try { fs.writeFileSync(OUT, JSON.stringify(snapshot)); } catch { /* never break the status line */ }
  }

  const model = data.model?.display_name ?? "Claude";
  const parts = [model];
  if (five) parts.push(`5h ${Math.round(Number(five.used_percentage))}%`);
  if (week) parts.push(`7d ${Math.round(Number(week.used_percentage))}%`);
  process.stdout.write(parts.join(" | "));
});
