import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BUILD_WORKERS_CONCURRENCY, buildWorkers, mapLimit, memo } from "../lib/state.mjs";

test("the worker concurrency cap is eight", () => {
  assert.equal(BUILD_WORKERS_CONCURRENCY, 8);
});

test("mapLimit preserves the input order however the tasks finish", async () => {
  const delays = [40, 5, 25, 0, 15, 30, 10, 20, 35, 1, 2, 3];
  const out = await mapLimit(delays, 8, async (delay, index) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return index;
  });
  assert.deepEqual(out, delays.map((_, index) => index));
});

test("mapLimit never runs more than the limit at the same time", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit(Array.from({ length: 30 }, (_, i) => i), 8, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(out, Array.from({ length: 30 }, (_, i) => i * 2));
});

test("mapLimit handles an empty list and a list smaller than the limit", async () => {
  assert.deepEqual(await mapLimit([], 8, async (value) => value), []);
  assert.deepEqual(await mapLimit([1, 2], 8, async (value) => value + 1), [2, 3]);
});

test("buildWorkers keeps the track order under concurrency", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-concurrency-"));
  const tracks = Array.from({ length: 20 }, (_, i) => ({
    name: `oc-${String(i).padStart(2, "0")}`,
    engine: "claude-code",
    board: true
  }));

  const workers = await buildWorkers({
    kit: { tracks },
    kitDir: dir,
    config: { __baseDir: dir, orchestrator: {} },
    repo: null,
    worktreeParent: null,
    now: new Date("2026-10-04T12:00:00Z")
  });

  assert.deepEqual(
    workers.map((worker) => worker.name),
    tracks.map((track) => track.name)
  );
});

test("memo shares one in-flight build and serves the cached value after it resolves", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const producer = async () => {
    calls += 1;
    await gate;
    return { built: true };
  };

  const first = memo("memo-shared", 60_000, producer, null);
  const second = memo("memo-shared", 60_000, producer, null);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1, "the two callers share one build");
  assert.equal(b, a);
  assert.deepEqual(a, { built: true });
  assert.equal(await memo("memo-shared", 60_000, producer, null), a);
  assert.equal(calls, 1, "a fresh TTL hit does not rebuild");
});

test("memo returns the fallback on failure and never caches a rejection", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    throw new Error("boom");
  };
  const fallback = { empty: true };

  assert.deepEqual(await memo("memo-fail", 60_000, producer, fallback), fallback);
  assert.equal(calls, 1);
  assert.deepEqual(await memo("memo-fail", 60_000, producer, fallback), fallback);
  assert.equal(calls, 2, "the failed build is not served from the cache");
});
