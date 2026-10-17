import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_HOUND_MODEL,
  buildHoundPrompt,
  createHoundService,
  parseVerdict,
  verdictKey
} from "../lib/hound.mjs";
import { ORPHAN_PENDING_TEXT, buildWorkers } from "../lib/state.mjs";

const HELPER = { exe: "C:\\tools\\opencode.cmd", server: "http://127.0.0.1:4096", model: DEFAULT_HOUND_MODEL };

function tempCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hound-cache-"));
  return path.join(dir, "verdicts.json");
}

test("the verdict key is project | track | status time, defaulting the project", () => {
  assert.equal(verdictKey("flota", "spec-draft", "2026-10-13T14:32:17"), "flota|spec-draft|2026-10-13T14:32:17");
  assert.equal(verdictKey(undefined, "", null), "default||");
});

test("only a strict done|error JSON object with a reason is a verdict", () => {
  assert.deepEqual(parseVerdict('{"verdict":"done","reason":"listo"}'), { verdict: "done", reason: "listo" });
  assert.deepEqual(parseVerdict('```json\n{"verdict":"error","reason":"falló la prueba"}\n```'), {
    verdict: "error",
    reason: "falló la prueba"
  });
  assert.equal(parseVerdict("creo que terminó bien"), null);
  assert.equal(parseVerdict('{"verdict":"maybe","reason":"no sé"}'), null);
  assert.equal(parseVerdict('{"verdict":"done","reason":""}'), null);
  assert.equal(parseVerdict('{"verdict":"done"}'), null);
  assert.equal(parseVerdict(""), null);
  assert.equal(parseVerdict(null), null);
});

test("the hound prompt carries the evidence and asks for strict JSON", () => {
  const prompt = buildHoundPrompt({
    trackName: "spec-draft",
    title: "Draft",
    statusText: "running",
    progress: { done: 7, total: 7 },
    steps: ["MSG: Listo, Sr."],
    commits: ["7bac3369 listo"]
  });
  assert.match(prompt, /spec-draft/);
  assert.match(prompt, /7\/7/);
  assert.match(prompt, /MSG: Listo, Sr\./);
  assert.match(prompt, /7bac3369 listo/);
  assert.match(prompt, /"verdict"/);
});

test("the hound shares one call, caches the verdict by key and re-judges a new status time", async () => {
  const cacheFile = tempCache();
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    return '{"verdict":"done","reason":"listo"}';
  };
  const service = createHoundService({ cacheFile, runner, now: () => 0 });

  assert.equal(service.verdictFor("flota|spec-draft|1"), null, "a miss without a request builder never calls");
  assert.equal(calls.length, 0);

  service.verdictFor("flota|spec-draft|1", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, "monitor-hound");
  assert.equal(calls[0].model, DEFAULT_HOUND_MODEL);

  assert.deepEqual(service.verdictFor("flota|spec-draft|1"), { verdict: "done", reason: "listo" });
  service.verdictFor("flota|spec-draft|1", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 1, "a cached verdict is never asked again");

  service.verdictFor("flota|spec-draft|2", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 2, "a new status time is judged again");
  assert.equal(fs.existsSync(cacheFile), true);
});

test("malformed model output is no verdict and retries only after the backoff", async () => {
  const calls = [];
  const runner = async () => {
    calls.push(1);
    return "no soy json";
  };
  let clock = 0;
  const service = createHoundService({
    cacheFile: tempCache(),
    runner,
    now: () => clock,
    baseBackoffMs: 60_000,
    maxBackoffMs: 600_000
  });

  service.verdictFor("bad", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 1);
  assert.equal(service.verdictFor("bad"), null, "malformed output leaves no cached verdict");

  service.verdictFor("bad", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 1, "no retry before the backoff elapses");

  clock += 61_000;
  service.verdictFor("bad", { helper: HELPER, prompt: "ev" });
  await service.flush();
  assert.equal(calls.length, 2);
});

test("a cached verdict survives a service restart", async () => {
  const cacheFile = tempCache();
  const first = createHoundService({
    cacheFile,
    runner: async () => '{"verdict":"error","reason":"quedó a medias"}',
    now: () => 0
  });
  first.verdictFor("flota|spec-draft|1", { helper: HELPER, prompt: "ev" });
  await first.flush();

  const second = createHoundService({
    cacheFile,
    runner: async () => {
      throw new Error("must not run");
    },
    now: () => 0
  });
  assert.deepEqual(second.verdictFor("flota|spec-draft|1"), { verdict: "error", reason: "quedó a medias" });
});

function orphanContext({ hound, pidStart, pidAlive = () => true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hound-worker-"));
  fs.writeFileSync(
    path.join(dir, "status-spec-draft.json"),
    JSON.stringify({ state: "running", pid: 30444, time: "2026-10-13T14:32:17.000Z" })
  );
  return {
    kit: { tracks: [{ name: "spec-draft", engine: "claude-code", title: "draft", board: true }] },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: new Date("2026-10-16T12:00:00Z"),
    project: { id: "flota", name: "Flota" },
    pidAlive,
    pidStart,
    hound
  };
}

const STARTED_AFTER = new Date("2026-10-16T08:13:00Z").getTime();
const STARTED_BEFORE = new Date("2026-10-13T14:00:00Z").getTime();

test("an orphaned worker with a done verdict turns green with the hound reason", async () => {
  const workers = await buildWorkers(
    orphanContext({
      hound: { verdictFor: () => ({ verdict: "done", reason: "Terminó y commiteó." }) },
      pidStart: () => STARTED_AFTER
    })
  );
  assert.equal(workers[0].state, "done");
  assert.equal(workers[0].stateKind, "done");
  assert.equal(workers[0].stateText, "Terminó y commiteó.");
});

test("an orphaned worker with an error verdict turns red with the hound reason", async () => {
  const workers = await buildWorkers(
    orphanContext({
      hound: { verdictFor: () => ({ verdict: "error", reason: "Falló la prueba." }) },
      pidStart: () => STARTED_AFTER
    })
  );
  assert.equal(workers[0].stateKind, "error");
  assert.equal(workers[0].stateText, "Falló la prueba.");
});

test("an orphaned worker with no verdict yet reads as error, never as stale", async () => {
  const workers = await buildWorkers(
    orphanContext({ hound: { verdictFor: () => null }, pidStart: () => STARTED_AFTER })
  );
  assert.equal(workers[0].stateKind, "error");
  assert.equal(workers[0].stateText, ORPHAN_PENDING_TEXT);
  assert.notEqual(workers[0].stateText, "sin reporte reciente");
});

test("a genuine runner (started before the status time) keeps its old behavior and is never judged", async () => {
  const workers = await buildWorkers(
    orphanContext({
      hound: {
        verdictFor: () => {
          throw new Error("a genuine runner must not be judged");
        }
      },
      pidStart: () => STARTED_BEFORE
    })
  );
  assert.equal(workers[0].stateKind, "stale");
});

test("a dead pid past the waiting window is orphaned too", async () => {
  const workers = await buildWorkers(
    orphanContext({ hound: { verdictFor: () => null }, pidStart: () => null, pidAlive: () => false })
  );
  assert.equal(workers[0].stateKind, "error");
  assert.equal(workers[0].stateText, ORPHAN_PENDING_TEXT);
});
