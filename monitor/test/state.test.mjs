import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyBranchColors,
  buildSnapshot,
  buildWorkerSteps,
  buildWorkers,
  GIT_LOG_LIMIT,
  hideFinishedWorkers,
  orchestratorInfo,
  resolveProjects
} from "../lib/state.mjs";
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

test("without projects the config keeps one implicit default project", () => {
  const repo = path.join(os.tmpdir(), "fleet-repo");
  const kitConfig = path.join(repo, "autopilot", "kit.config.json");
  const projects = resolveProjects({ __baseDir: "C:\\cfg", repo, workers: { kitConfig } });

  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0], { id: "default", name: "fleet-repo", repo, kitConfig });
});

test("a projects list is normalized with its names and resolved relative paths", () => {
  const base = path.join(os.tmpdir(), "fleet-projects");
  const projects = resolveProjects({
    __baseDir: base,
    projects: [
      { id: "korsakov", name: "Korsakov Orchestrator", repo: "../korsakov", kitConfig: "kits/korsakov.json" },
      { id: "web" }
    ]
  });

  assert.equal(projects.length, 2);
  assert.deepEqual(projects[0], {
    id: "korsakov",
    name: "Korsakov Orchestrator",
    repo: path.resolve(base, "../korsakov"),
    kitConfig: path.resolve(base, "kits/korsakov.json")
  });
  assert.deepEqual(projects[1], { id: "web", name: "web", repo: null, kitConfig: null });
});

test("an implicit project without a repo falls back to the default name", () => {
  const projects = resolveProjects({ __baseDir: os.tmpdir() });
  assert.deepEqual(projects, [{ id: "default", name: "default", repo: null, kitConfig: null }]);
});

test("the snapshot names the project it was built for", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-snapshot-"));
  const snapshot = await buildSnapshot(
    { __baseDir: dir, workers: {}, pollSeconds: 5, translate: { enabled: false } },
    { now: new Date("2026-10-05T12:00:00Z"), project: { id: "web", name: "Web", repo: null, kitConfig: null } }
  );

  assert.deepEqual(snapshot.project, { id: "web", name: "Web" });
  assert.equal(snapshot.generatedAt, "2026-10-05T12:00:00.000Z");
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

test("buildWorkerSteps maps Claude, Codex and Antigravity tracks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-worker-steps-"));
  const transcript = path.join(dir, "agent.jsonl");
  fs.copyFileSync(path.join(here, "fixtures", "claude-steps.jsonl"), transcript);
  fs.copyFileSync(path.join(here, "fixtures", "codex-steps.jsonl"), path.join(dir, "log-codex-a-1.jsonl"));
  const agyTranscript = path.join(dir, "agy.ndjson");
  fs.copyFileSync(path.join(here, "fixtures", "agy-steps.ndjson"), agyTranscript);
  const kitConfig = path.join(dir, "kit.config.json");
  fs.writeFileSync(
    kitConfig,
    JSON.stringify({
      tracks: [
        { name: "claude-a", engine: "claude-code", activityFile: transcript, board: true },
        { name: "codex-a", engine: "codex", board: true },
        { name: "agy-a", engine: "antigravity", activityFile: agyTranscript, board: true }
      ]
    })
  );
  const config = { __baseDir: dir, workers: { kitConfig } };
  const project = { id: "p", name: "P", repo: null, kitConfig };

  const claude = await buildWorkerSteps(config, { project, worker: "claude-a" });
  assert.equal(claude.engine, "claude-code");
  assert.ok(claude.steps.length > 0);
  assert.equal(claude.steps[0].type, "message");
  assert.equal(claude.unsupported, undefined);

  const codex = await buildWorkerSteps(config, { project, worker: "codex-a" });
  assert.equal(codex.engine, "codex");
  assert.ok(codex.steps.length > 0, "codex workers are no longer unsupported");
  assert.equal(codex.unsupported, undefined);
  assert.ok(codex.steps.some((step) => step.type === "command"));

  const agy = await buildWorkerSteps(config, { project, worker: "agy-a" });
  assert.equal(agy.engine, "antigravity");
  assert.ok(agy.steps.length > 0, "antigravity workers are no longer unsupported");
  assert.equal(agy.unsupported, undefined);
  assert.ok(agy.steps.some((step) => step.type === "command"));

  assert.equal(await buildWorkerSteps(config, { project, worker: "nope" }), null);
  assert.equal(await buildWorkerSteps(config, { project, worker: "" }), null);
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

test("recent Claude Code sessions of the project become orchestrator cards", async () => {
  const { claudeProjectDir, withOrchestratorTracks } = await import("../lib/state.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-home-"));
  const repo = path.join(home, "Work Repo");
  const dir = claudeProjectDir(repo, home);
  assert.equal(path.basename(dir), path.resolve(repo).replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date("2026-10-06T12:00:00Z");
  const touch = (name, minutesAgo) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "{}\n");
    const at = new Date(now.getTime() - minutesAgo * 60000);
    fs.utimesSync(file, at, at);
  };
  touch("aaaaaaaa-1111.jsonl", 1);
  touch("bbbbbbbb-2222.jsonl", 30);
  touch("cccccccc-3333.jsonl", 600);
  fs.mkdirSync(path.join(dir, "aaaaaaaa-1111", "subagents"), { recursive: true });

  const kit = { tracks: [{ name: "builder-a", engine: "opencode" }] };
  const out = withOrchestratorTracks(kit, { repo }, { orchestrator: { model: "claude-opus-5-5", effort: "high" } }, now, { home });
  assert.deepEqual(out.tracks.map((track) => track.name), ["claude-aaaaaaaa", "claude-bbbbbbbb", "builder-a"]);
  assert.equal(out.tracks[0].__state, "working");
  assert.equal(out.tracks[1].__state, "waiting");
  assert.equal(out.tracks[0].engine, "claude-code");
  assert.equal(out.tracks[0].workdir, repo);
  assert.equal(kit.tracks.length, 1, "the kit itself is never modified");
  assert.equal(withOrchestratorTracks(kit, { repo }, { orchestratorSessions: false }, now, { home }), kit);
  assert.equal(withOrchestratorTracks(kit, { repo: path.join(home, "nope") }, {}, now, { home }), kit);
});
test("an orchestrator card names the model and effort the session really uses", async () => {
  const { transcriptModel } = await import("../lib/state.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-model-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5" } }),
    JSON.stringify({ type: "system", effort: "medium" }),
    JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } })
  ].join("\n"));
  assert.deepEqual(transcriptModel(file), { model: "claude-opus-5-5", effort: "medium" });
  assert.deepEqual(transcriptModel(path.join(dir, "missing.jsonl")), { model: null, effort: null });
});