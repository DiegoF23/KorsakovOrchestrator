import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyBranchColors, buildWorkers, GIT_LOG_LIMIT, hideFinishedWorkers, orchestratorInfo } from "../lib/state.mjs";
import { branchColor, NEUTRAL_BRANCH_COLOR } from "../lib/graph.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the git history goes deep enough to fill the scrollable tree", () => {
  assert.equal(GIT_LOG_LIMIT, 200);
});

test("the snapshot exposes the orchestrator model and effort for the header", () => {
  assert.deepEqual(
    orchestratorInfo({
      orchestrator: { engine: "claude-code", model: "claude-opus-5-5", effort: "high", label: "Claude Code" }
    }),
    {
      engine: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      label: "Claude Code",
      text: "claude-opus-5-5 · high"
    }
  );
  const fallback = orchestratorInfo({});
  assert.equal(fallback.engine, "claude-code");
  assert.equal(fallback.effort, "");
  assert.equal(fallback.label, "Orquestador");
});

test("the example monitor config declares the orchestrator effort", () => {
  const config = JSON.parse(fs.readFileSync(path.join(here, "..", "fleet-monitor.config.example.json"), "utf8"));
  assert.equal(config.orchestrator?.effort, "high");
});

test("the example monitor config hides finished cards after five minutes", () => {
  const config = JSON.parse(fs.readFileSync(path.join(here, "..", "fleet-monitor.config.example.json"), "utf8"));
  assert.equal(config.cleanup?.hideFinishedAfterMinutes, 5);
});

test("a Claude track wires its model, effort and activityFile into the card", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-claude-"));
  const transcript = path.join(dir, "agent.jsonl");
  fs.copyFileSync(path.join(here, "fixtures", "claude-transcript.jsonl"), transcript);

  const workers = await buildWorkers({
    kit: {
      tracks: [
        { name: "claude-a", engine: "claude-code", model: "claude-sonnet-4-5", effort: "high", activityFile: transcript, board: true }
      ]
    },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: new Date("2026-10-04T12:00:00Z")
  });

  assert.equal(workers.length, 1);
  assert.equal(workers[0].model, "claude-sonnet-4-5 · high");
  assert.ok(workers[0].activity.events.length > 0);
  assert.equal(workers[0].activity.notice, null);
});

test("an Antigravity track wires its model and activityFile into the card", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-agy-"));
  const transcript = path.join(dir, "agent.ndjson");
  fs.copyFileSync(path.join(here, "fixtures", "agy-stream.ndjson"), transcript);

  const workers = await buildWorkers({
    kit: {
      tracks: [
        { name: "agy-a", engine: "antigravity", model: "Gemini 3.1 Pro (High)", activityFile: transcript, board: true }
      ]
    },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: new Date("2026-10-04T12:00:00Z")
  });

  assert.equal(workers.length, 1);
  assert.equal(workers[0].model, "Gemini 3.1 Pro (High)");
  assert.ok(workers[0].activity.events.length > 0);
  assert.equal(workers[0].activity.notice, null);
});

const cleanupNow = new Date("2026-10-04T12:00:00Z");
const statusAt = (minutesAgo) => new Date(cleanupNow.getTime() - minutesAgo * 60000).toISOString();
const cleanupConfig = { cleanup: { hideFinishedAfterMinutes: 60 } };

test("a finished or failed card older than the threshold leaves the board", () => {
  const workers = [
    { name: "done-old", state: "done", stateKind: "done", statusTime: statusAt(61) },
    { name: "error-old", state: "error", stateKind: "error", statusTime: statusAt(61) }
  ];
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 2);
  assert.deepEqual(result.workers, []);
  assert.deepEqual(result.hiddenWorkers.map((worker) => worker.name), ["done-old", "error-old"]);
});

test("the five-minute default hides cards older than five minutes and keeps the rest", () => {
  const config = { cleanup: { hideFinishedAfterMinutes: 5 } };
  const workers = [
    { name: "done-old", state: "done", stateKind: "done", statusTime: statusAt(6) },
    { name: "done-fresh", state: "done", stateKind: "done", statusTime: statusAt(4) }
  ];
  const result = hideFinishedWorkers(workers, config, cleanupNow);
  assert.equal(result.hiddenFinished, 1);
  assert.deepEqual(result.workers.map((worker) => worker.name), ["done-fresh"]);
  assert.deepEqual(result.hiddenWorkers.map((worker) => worker.name), ["done-old"]);
});

test("a finished card inside the threshold stays", () => {
  const workers = [{ name: "done-fresh", state: "done", stateKind: "done", statusTime: statusAt(59) }];
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 0);
  assert.equal(result.workers.length, 1);
});

test("a finished card exactly at the threshold stays", () => {
  const workers = [{ name: "done-edge", state: "done", stateKind: "done", statusTime: statusAt(60) }];
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 0);
  assert.equal(result.workers.length, 1);
});

test("working, waiting and stale cards never hide, however old they are", () => {
  const workers = [
    { name: "working", state: "working", stateKind: "working", statusTime: statusAt(600) },
    { name: "waiting", state: "waiting", stateKind: "waiting", statusTime: statusAt(600) },
    { name: "stale", state: "stale", stateKind: "stale", statusTime: statusAt(600) }
  ];
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 0);
  assert.equal(result.workers.length, 3);
});

test("cleanup is disabled with a missing key or a zero threshold", () => {
  const workers = [{ name: "done-old", state: "done", stateKind: "done", statusTime: statusAt(9999) }];
  const missing = hideFinishedWorkers(workers, {}, cleanupNow);
  assert.equal(missing.hiddenFinished, 0);
  assert.equal(missing.workers.length, 1);
  assert.deepEqual(missing.hiddenWorkers, []);
  const zero = hideFinishedWorkers(workers, { cleanup: { hideFinishedAfterMinutes: 0 } }, cleanupNow);
  assert.equal(zero.hiddenFinished, 0);
  assert.equal(zero.workers.length, 1);
  assert.deepEqual(zero.hiddenWorkers, []);
});

test("a finished card without a valid time or status file is never hidden", () => {
  const workers = [
    { name: "no-time", state: "error", stateKind: "error", statusTime: null },
    { name: "bad-time", state: "error", stateKind: "error", statusTime: "not a date" },
    { name: "no-file", state: "error", stateKind: "error" }
  ];
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 0);
  assert.equal(result.workers.length, 3);
});

test("a worker card carries its status time so finished cards can age out", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-status-"));
  fs.writeFileSync(
    path.join(dir, "status-oc-a.json"),
    JSON.stringify({ state: "finished", exitCode: 0, time: statusAt(90) })
  );

  const workers = await buildWorkers({
    kit: { tracks: [{ name: "oc-a", engine: "opencode", board: true }] },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: cleanupNow
  });

  assert.equal(workers.length, 1);
  assert.equal(workers[0].state, "done");
  assert.equal(workers[0].statusTime, statusAt(90));
  const result = hideFinishedWorkers(workers, cleanupConfig, cleanupNow);
  assert.equal(result.hiddenFinished, 1);
  assert.equal(result.hiddenWorkers.length, 1);
  assert.equal(result.hiddenWorkers[0].name, "oc-a");
});

test("worker cards take the colour of their branch lane, neutral when the tree lacks it", () => {
  const workers = [{ branch: "feat/a" }, { branch: "feat/b" }, { name: "no-branch" }];
  applyBranchColors(workers, { branches: ["feat/a"] });
  assert.equal(workers[0].branchColor, branchColor("feat/a"));
  assert.equal(workers[1].branchColor, NEUTRAL_BRANCH_COLOR);
  assert.equal(workers[2].branchColor, NEUTRAL_BRANCH_COLOR);
  applyBranchColors(workers, null);
  assert.equal(workers[0].branchColor, NEUTRAL_BRANCH_COLOR);
});
