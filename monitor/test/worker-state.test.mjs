import test from "node:test";
import assert from "node:assert/strict";

import { resolveRemainingText, workerStateKind } from "../lib/format.mjs";

test("a waiting supervisor reads esperando even with an old DONE line", () => {
  const text = resolveRemainingText({ status: { state: "waiting" }, evidenceText: "X-STATUS: DONE\n", prefix: "X-STATUS", etaEnd: null });
  assert.equal(text, "esperando");
  assert.equal(resolveRemainingText({ status: { state: "running" }, evidenceText: "X-STATUS: DONE\n", prefix: "X-STATUS", etaEnd: null }), "");
});
import { workerState } from "../lib/state.mjs";

const now = new Date("2026-10-03T20:00:00");
const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60000).toISOString();
const alive = () => true;
const dead = () => false;

test("a fresh running builder is working", () => {
  assert.equal(workerState({ state: "running", pid: 1, time: at(1) }, now, alive), "working");
});

test("a live builder with a late heartbeat is blue, not stopped", () => {
  const state = workerState({ state: "running", pid: 1, time: at(9) }, now, alive);
  assert.equal(state, "stale");
  assert.equal(workerStateKind(state), "stale");
});

test("the gap between two attempts is cyan (waiting)", () => {
  assert.equal(workerState({ state: "running", pid: 1, time: at(1) }, now, dead), "waiting");
});

test("a builder gone for minutes without finishing is orphaned", () => {
  assert.equal(workerState({ state: "running", pid: 1, time: at(10) }, now, dead), "orphaned");
});

test("a live pid that started after the status time is orphaned, not stale", () => {
  const statusTime = at(9);
  const startedLater = new Date(now.getTime() - 2 * 60000).getTime();
  const start = (pid) => (pid === 7 ? startedLater : null);
  assert.equal(workerState({ state: "running", pid: 7, time: statusTime }, now, alive, start), "orphaned");
});

test("a genuine runner that started before the status time keeps its old behavior", () => {
  const started = new Date(now.getTime() - 60 * 60000).getTime();
  const start = () => started;
  assert.equal(workerState({ state: "running", pid: 7, time: at(1) }, now, alive, start), "working");
  assert.equal(workerState({ state: "running", pid: 7, time: at(9) }, now, alive, start), "stale");
});

test("the process start time allows two seconds of clock skew", () => {
  const statusMs = now.getTime() - 9 * 60000;
  const start = () => statusMs + 1500;
  assert.equal(workerState({ state: "running", pid: 7, time: new Date(statusMs).toISOString() }, now, alive, start), "stale");
  const late = () => statusMs + 2500;
  assert.equal(workerState({ state: "running", pid: 7, time: new Date(statusMs).toISOString() }, now, alive, late), "orphaned");
});

test("a track parked on WAITING (exit 5) reads esperando, not stopped", () => {
  const status = { state: "finished", exitCode: 5, time: at(30) };
  assert.equal(workerState(status, now, dead), "waiting");
  assert.equal(resolveRemainingText({ status, etaEnd: null }), "esperando");
});

test("finished states keep their meaning", () => {
  assert.equal(workerState({ state: "finished", exitCode: 0, time: at(30) }, now, dead), "done");
  assert.equal(workerState({ state: "finished", exitCode: 2, time: at(30) }, now, dead), "error");
  assert.equal(workerState({ state: "waiting", time: at(30) }, now, dead), "waiting");
  assert.equal(workerState(null, now, dead), "error");
});
