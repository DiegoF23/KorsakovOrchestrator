// Refreshes the OpenCode Go usage meters (5h / week / month) from the official
// endpoint with the locally stored key, at most once every MIN_AGE_MS, and
// writes them in the fleet monitor's "official" format. No model request.
// Run from a Claude Code UserPromptSubmit hook (async) or by hand:
//   node opencode-quota.mjs [--force]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.join(os.homedir(), ".claude", "quota", "opencode-official.json");
const MIN_AGE_MS = 5 * 60 * 1000;
const force = process.argv.includes("--force");

async function main() {
  if (!force) {
    try {
      if (Date.now() - fs.statSync(OUT).mtimeMs < MIN_AGE_MS) return;
    } catch { /* no snapshot yet */ }
  }
  const authFile = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
  const key = JSON.parse(fs.readFileSync(authFile, "utf8"))["opencode-go"]?.key;
  if (!key) throw new Error("no opencode-go key in auth.json");

  const res = await fetch("https://opencode.ai/zen/go/v1/usage", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  const usage = JSON.parse(body).usage ?? {};
  const snapshot = {
    updatedAt: new Date().toISOString(),
    rolling: usage.rolling?.percent ?? 0,
    weekly: usage.weekly?.percent ?? 0,
    monthly: usage.monthly?.percent ?? 0,
    rollingResetsAt: usage.rolling?.resetsAt ?? null,
    weeklyResetsAt: usage.weekly?.resetsAt ?? null,
    monthlyResetsAt: usage.monthly?.resetsAt ?? null,
    source: "zen/go/v1/usage"
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot));
}

// exitCode instead of process.exit: exiting while fetch handles close trips a
// libuv assertion on Windows. Errors never block the prompt (async hook).
main().catch((err) => {
  console.error(`opencode-quota: ${err.message}`);
  process.exitCode = 1;
});
