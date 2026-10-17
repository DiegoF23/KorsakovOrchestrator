import { test } from "node:test";
import assert from "node:assert/strict";
import { hideFinishedWorkers } from "../lib/state.mjs";

const config = { cleanup: { hideFinishedAfterMinutes: 2 } };
const at = (minutes) => new Date(Date.UTC(2026, 9, 16, 12, minutes, 0));
const card = (stateKind, statusTime = "") => ({ name: "t1", stateKind, statusTime });

test("a finished card without a status time hides two minutes after it was first seen", () => {
  const seen = new Map();
  assert.equal(hideFinishedWorkers([card("error")], config, at(0), seen).hiddenFinished, 0);
  assert.equal(hideFinishedWorkers([card("error")], config, at(1), seen).hiddenFinished, 0);
  assert.equal(hideFinishedWorkers([card("error")], config, at(3), seen).hiddenFinished, 1);
});

test("a state change restarts the countdown", () => {
  const seen = new Map();
  hideFinishedWorkers([card("error")], config, at(0), seen);
  hideFinishedWorkers([card("working")], config, at(1), seen);
  assert.equal(hideFinishedWorkers([card("error")], config, at(3), seen).hiddenFinished, 0);
  assert.equal(hideFinishedWorkers([card("error")], config, at(6), seen).hiddenFinished, 1);
});

test("a card with a status time keeps using it", () => {
  const seen = new Map();
  const old = card("done", at(0).toISOString());
  assert.equal(hideFinishedWorkers([old], config, at(5), seen).hiddenFinished, 1);
});

test("without a tracker the old behaviour holds: no status time never hides", () => {
  assert.equal(hideFinishedWorkers([card("error")], config, at(30)).hiddenFinished, 0);
});
