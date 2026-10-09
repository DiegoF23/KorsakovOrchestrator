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
  discoverClaudeProjects,
  agyConversationTitle,
  agyLastStepFailed,
  recentClaudeSubagents,
  finishedByArrival,
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

test("a Claude card exposes the todo progress, the measured remaining and the idle warning", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-claude-progress-"));
  const transcript = path.join(dir, "agent.jsonl");
  fs.copyFileSync(path.join(here, "fixtures", "claude-progress.jsonl"), transcript);
  fs.writeFileSync(
    path.join(dir, "status-claude-p.json"),
    JSON.stringify({ state: "running", pid: process.pid, time: "2026-10-04T11:59:30.000Z" })
  );

  const workers = await buildWorkers({
    kit: {
      tracks: [
        { name: "claude-p", engine: "claude-code", title: "progreso de prueba", activityFile: transcript, board: true }
      ]
    },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: new Date("2026-10-04T12:00:00Z")
  });

  assert.equal(workers.length, 1);
  const card = workers[0];
  assert.equal(card.stateKind, "working");
  assert.deepEqual(card.progress, {
    items: [
      { text: "leer el brief", status: "done" },
      { text: "escribir el parser", status: "done" },
      { text: "correr las pruebas", status: "doing" }
    ],
    done: 2,
    total: 3,
    current: "correr las pruebas",
    firstAt: "2026-10-04T10:00:02.000Z",
    lastStepAt: "2026-10-04T10:07:00.000Z"
  });
  // rate = (12:00 - 10:00:02) / 2 done; one item left -> ~59:59.
  assert.equal(card.remaining, "~59:59");
  assert.equal(card.pace, null, "without etaEnd there is no pace");
  assert.equal(card.lastStepAt, "2026-10-04T10:07:00.000Z");
  assert.equal(card.idleText, "sin movimiento hace 113 min");
  assert.equal(card.title, "CLAUDE - progreso de prueba - ~59:59");
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
  const out = withOrchestratorTracks(kit, { repo }, { orchestratorSessions: true, orchestrator: { model: "claude-opus-5-5", effort: "high" } }, now, { home });
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
test("subagents delegated by the project's Claude sessions become cards; the orchestrator itself is off by default", async () => {
  const { claudeProjectDir, withOrchestratorTracks } = await import("../lib/state.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-sub-"));
  const repo = path.join(home, "Repo");
  const dir = claudeProjectDir(repo, home);
  const sub = path.join(dir, "session-1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const now = new Date("2026-10-06T12:00:00Z");
  const write = (file, text, minutesAgo) => {
    fs.writeFileSync(file, text);
    const at = new Date(now.getTime() - minutesAgo * 60000);
    fs.utimesSync(file, at, at);
  };
  write(path.join(dir, "session-1.jsonl"), "{}\n", 1);
  write(path.join(sub, "agent-abc123def456.jsonl"), JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5" } }) + "\n", 1);
  fs.writeFileSync(path.join(sub, "agent-abc123def456.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Fix the login form", model: "sonnet" }));
  write(path.join(sub, "agent-old999old999.jsonl"), "{}\n", 300);

  const out = withOrchestratorTracks({ tracks: [] }, { repo }, {}, now, { home });
  assert.deepEqual(out.tracks.map((track) => track.name), ["sub-abc123def4"]);
  assert.equal(out.tracks[0].title, "Fix the login form");
  assert.equal(out.tracks[0].model, "claude-sonnet-5-5");
  assert.equal(out.tracks[0].__state, "working");
  const off = withOrchestratorTracks({ tracks: [] }, { repo }, { claudeSubagents: false }, now, { home });
  assert.deepEqual(off.tracks, []);
});
test("a board:false track still shows while its status says it is running", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-board-"));
  const transcript = path.join(dir, "agent.jsonl");
  fs.copyFileSync(path.join(here, "fixtures", "claude-transcript.jsonl"), transcript);
  const now = new Date("2026-10-06T12:00:00Z");
  const status = (name, state, minutesAgo) =>
    fs.writeFileSync(path.join(dir, `status-${name}.json`), JSON.stringify({ track: name, state, time: new Date(now.getTime() - minutesAgo * 60000).toISOString() }));
  status("live", "running", 1);
  status("stale", "running", 30);
  status("done", "finished", 1);
  const track = (name) => ({ name, engine: "claude-code", activityFile: transcript, board: false });
  const workers = await buildWorkers({
    kit: { tracks: [track("live"), track("stale"), track("done"), track("none")] },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now
  });
  assert.deepEqual(workers.map((worker) => worker.name), ["live"]);
});
test("finishedByArrival keeps active cards first and the latest finished first", () => {
  const out = finishedByArrival([
    { name: "old", stateKind: "done", statusTime: "2026-10-07T01:00:00Z" },
    { name: "run", stateKind: "working" },
    { name: "new", stateKind: "error", statusTime: "2026-10-07T05:00:00Z" }
  ]);
  assert.deepEqual(out.map((w) => w.name), ["run", "new", "old"]);
});

test("orchestratorInfo reads the model of the latest project session", async () => {
  const fsx = await import("node:fs");
  const osx = await import("node:os");
  const pathx = await import("node:path");
  const home = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "orch-"));
  const repo = pathx.join(home, "repo");
  const dir = pathx.join(home, ".claude", "projects", pathx.resolve(repo).replace(/[^A-Za-z0-9]/g, "-"));
  fsx.mkdirSync(dir, { recursive: true });
  fsx.writeFileSync(pathx.join(dir, "s1.jsonl"), JSON.stringify({ model: "claude-sonnet-5-5" }) + String.fromCharCode(10) + JSON.stringify({ effort: "low" }) + String.fromCharCode(10));
  const info = orchestratorInfo({ orchestrator: { engine: "claude-code", model: "claude-opus-5-5", effort: "high" } }, repo, home);
  assert.equal(info.model, "claude-sonnet-5-5");
  assert.equal(info.effort, "low");
  assert.equal(orchestratorInfo({ orchestrator: { engine: "codex", model: "x" } }, repo, home).model, "x");
});

test("a subagent file touched today but last active days ago is not recent", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "touch-"));
  const sub = path.join(home, "sess", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  fs.writeFileSync(path.join(sub, "agent-old.jsonl"), JSON.stringify({ timestamp: old }) + String.fromCharCode(10));
  const fresh = new Date().toISOString();
  fs.writeFileSync(path.join(sub, "agent-new.jsonl"), JSON.stringify({ timestamp: fresh }) + String.fromCharCode(10));
  const found = recentClaudeSubagents(home, new Date(), { recentMs: 3600000 });
  assert.deepEqual(found.map((f) => f.id), ["new"]);
});

test("an agy run whose last step is an ERROR reads as failed; a normal tail does not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agyerr-"));
  const nl = String.fromCharCode(10);
  const bad = path.join(dir, "bad.jsonl");
  const ok = path.join(dir, "ok.jsonl");
  fs.writeFileSync(bad, JSON.stringify({ status: "DONE" }) + nl + JSON.stringify({ status: "ERROR" }) + nl);
  fs.writeFileSync(ok, JSON.stringify({ status: "ERROR" }) + nl + JSON.stringify({ status: "DONE" }) + nl);
  assert.equal(agyLastStepFailed(bad), true);
  assert.equal(agyLastStepFailed(ok), false);
  assert.equal(agyLastStepFailed(path.join(dir, "missing.jsonl")), false);
});

test("an agy title prefers a Title line over a leading rule line", () => {
  const nl = String.fromCharCode(10);
  const content = "You have NO terminal: never run anything." + nl + "Title: Review the S2 schema";
  const line = JSON.stringify({ type: "USER_INPUT", content });
  assert.equal(agyConversationTitle(line), "Review the S2 schema");
  assert.equal(agyConversationTitle(JSON.stringify({ type: "USER_INPUT", content: "Plain first line" })), "Plain first line");
});

test("Claude Code projects are discovered from their transcripts, only when enabled", () => {
  const home = fs.mkdtempSync(path.join(os.homedir(), ".disc-test-"));
  try {
    const repo = path.join(home, "my-app");
    fs.mkdirSync(repo, { recursive: true });
    const dir = path.join(home, ".claude", "projects", "C--my-app");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "s.jsonl"), JSON.stringify({ cwd: repo }) + String.fromCharCode(10));
    const found = discoverClaudeProjects(home, Date.now() + 999999);
    assert.deepEqual(found.map((p) => p.name), ["my-app"]);
    assert.equal(resolveProjects({ __baseDir: home, repo }, { home }).length, 1);
    const on = resolveProjects({ __baseDir: home, repo: path.join(home, "other"), discoverClaudeProjects: true }, { home });
    assert.ok(on.some((p) => p.name === "my-app"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a transcript whose last entry is a final assistant answer reads as answered", async () => {
  const { transcriptTurnComplete } = await import("../lib/state.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-"));
  const nl = String.fromCharCode(10);
  const write = (name, entries) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join(nl) + nl);
    return file;
  };
  const answer = { type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "hecho" }] } };
  const tool = { type: "assistant", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] } };
  const prompt = { type: "user", message: { role: "user", content: "hola" } };
  assert.equal(transcriptTurnComplete(write("a.jsonl", [prompt, tool, answer]), 1, 1), true);
  assert.equal(transcriptTurnComplete(write("b.jsonl", [prompt, answer, prompt]), 2, 1), false);
  assert.equal(transcriptTurnComplete(write("c.jsonl", [prompt, tool]), 3, 1), false);
  const streamed = { type: "assistant", message: { role: "assistant", stop_reason: null, content: [{ type: "text", text: "..." }] } };
  assert.equal(transcriptTurnComplete(write("d.jsonl", [prompt, streamed]), 4, 5000), false);
  assert.equal(transcriptTurnComplete(write("e.jsonl", [prompt, streamed]), 5, 20000), true);
});

test("finishedByArrival is stable when several finished cards have no valid time", () => {
  const out = finishedByArrival([
    { name: "a", stateKind: "done", statusTime: null },
    { name: "b", stateKind: "done", statusTime: "invalid" },
    { name: "c", stateKind: "done", statusTime: "2026-10-07T05:00:00Z" }
  ]);
  assert.equal(out[0].name, "c");
  assert.deepEqual(out.slice(1).map((w) => w.name), ["a", "b"]);
});

test("an assistant answer whose content is a plain string counts as text", async () => {
  const { transcriptTurnComplete } = await import("../lib/state.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnstr-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, JSON.stringify({ type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: "listo" } }) + String.fromCharCode(10));
  assert.equal(transcriptTurnComplete(file, 77, 1), true);
});

test("subagents launched in one burst share batches of four; a batch hides only with its last member", async () => {
  const { assignBatches } = await import("../lib/state.mjs");
  const agents = [];
  for (let i = 0; i < 7; i += 1) agents.push({ id: "a" + i, birthMs: 1000000 + i * 500 });
  agents.push({ id: "late", birthMs: 1000000 + 10 * 60000 });
  const keys = assignBatches(agents);
  assert.equal(new Set([keys.get("a0"), keys.get("a1"), keys.get("a2"), keys.get("a3")]).size, 1);
  assert.notEqual(keys.get("a3"), keys.get("a4"));
  assert.equal(keys.get("a4"), keys.get("a6"));
  assert.notEqual(keys.get("late"), keys.get("a6"));

  const now = new Date("2026-10-08T12:00:00Z");
  const old = "2026-10-08T11:50:00Z";
  const fresh = "2026-10-08T11:59:30Z";
  const cfg = { cleanup: { hideFinishedAfterMinutes: 2 } };
  const mk = (name, statusTime, miniGroup) => ({ name, stateKind: "done", statusTime, miniGroup });
  const kept = hideFinishedWorkers([mk("x", old, "b1"), mk("y", fresh, "b1")], cfg, now);
  assert.equal(kept.workers.length, 2);
  const gone = hideFinishedWorkers([mk("x", old, "b1"), mk("y", old, "b1"), mk("z", old, null)], cfg, now);
  assert.equal(gone.workers.length, 0);
  assert.equal(gone.hiddenWorkers.length, 3);
});

test("OpenCode sessions of the project folder become cards, newest title once, skipping kit tracks", async () => {
  const { openCodeSessionTracks } = await import("../lib/state.mjs");
  const now = new Date("2026-10-08T12:00:00Z");
  const repo = path.resolve(os.tmpdir(), "oc-repo");
  const at = (minutesAgo) => now.getTime() - minutesAgo * 60000;
  const sessions = [
    { id: "ses_aaaaaaaa11", title: "sabueso-1", directory: repo, time: { updated: at(1) }, model: { providerID: "opencode-go", id: "longcat-2.5-preview-free" } },
    { id: "ses_bbbbbbbb22", title: "sabueso-1", directory: repo, time: { updated: at(30) } },
    { id: "ses_cccccccc33", title: "mail-alerts attempt 1", directory: repo, time: { updated: at(2) } },
    { id: "ses_dddddddd44", title: "old", directory: repo, time: { updated: at(300) } },
    { id: "ses_eeeeeeee55", title: "other", directory: path.resolve(os.tmpdir(), "elsewhere"), time: { updated: at(1) } }
  ];
  const tracks = openCodeSessionTracks(sessions, { repo }, { tracks: [{ name: "mail-alerts" }] }, now);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, "sabueso-1");
  assert.equal(tracks[0].sessionId, "ses_aaaaaaaa11");
  assert.equal(tracks[0].__state, "working");
  assert.equal(tracks[0].model, "opencode-go/longcat-2.5-preview-free");
});
