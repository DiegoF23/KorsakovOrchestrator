import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { activity as agyActivity, mapAgyBrainEntries, mapAgyBrainSteps, steps as agySteps } from "../adapters/antigravity.mjs";
import { parseJsonlTail } from "../adapters/claude-code.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const read = (name) => fs.readFileSync(path.join(fixtures, name), "utf8");

const REPO = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo";
const WT = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo-worktrees";
const CTX = { repo: REPO, worktreeParent: WT };

test("the brain transcript maps to normalized card events", () => {
  const entries = parseJsonlTail(read("agy-brain-transcript.jsonl"));
  const events = mapAgyBrainEntries(entries, CTX);

  assert.deepEqual(
    events.map((event) => `${event.kind} ${event.detail}`),
    [
      "READ widget.mjs",
      "READ src",
      "READ TODO",
      "ERR declaring permissions: grep failed: boom",
      "EDIT nuevo.mjs",
      "EDIT widget.mjs",
      "EDIT widget.mjs",
      "CMD node --test",
      "MSG mcp engram/mem_save",
      "MSG mcp fetch/get_url",
      "MSG plan",
      "DONE Listo, quedó todo andando."
    ]
  );
  assert.equal(events[0].time, "2026-10-06T12:00:01.000Z");
  assert.equal(events.at(-1).time, "2026-10-06T12:00:20.000Z");
});

test("the brain transcript maps to full typed steps", () => {
  const entries = parseJsonlTail(read("agy-brain-transcript.jsonl"));
  const steps = mapAgyBrainSteps(entries, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    [
      "thinking/done",
      "read/done",
      "read/done",
      "read/error",
      "write/done",
      "edit/done",
      "edit/done",
      "command/done",
      "memory/done",
      "tool/done",
      "tool/running",
      "message/done"
    ]
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      "agy-brain-1-think",
      "agy-brain-1-0",
      "agy-brain-3-0",
      "agy-brain-5-0",
      "agy-brain-7-0",
      "agy-brain-9-0",
      "agy-brain-11-0",
      "agy-brain-13-0",
      "agy-brain-15-0",
      "agy-brain-17-0",
      "agy-brain-19-0",
      "agy-brain-20-text"
    ],
    "step_index keeps the ids stable for polling"
  );
  assert.equal(steps[0].time, "2026-10-06T12:00:01.000Z");
  assert.equal(steps[0].data.text, "I will read the widget before touching it.\n");

  const readStep = steps[1];
  assert.equal(readStep.tool, "view_file");
  assert.equal(readStep.path, "C:\\demo\\src\\widget.mjs");
  assert.equal(readStep.title, "leer C:\\demo\\src\\widget.mjs");

  assert.equal(steps[2].title, "leer C:\\demo\\src");
  assert.equal(steps[2].path, "C:\\demo\\src");

  const failed = steps[3];
  assert.equal(failed.tool, "grep_search");
  assert.equal(failed.title, "buscar «TODO» en C:\\demo\\src");
  assert.equal(failed.data.error, "declaring permissions: grep failed: boom");

  const write = steps[4];
  assert.equal(write.title, "escribir C:\\demo\\src\\nuevo.mjs");
  assert.equal(write.data.content, "export const nuevo = true;\n");

  assert.deepEqual(steps[5].data, { oldText: "const a = 1;", newText: "const a = 2;" });

  const multi = steps[6];
  assert.equal(multi.title, "editar C:\\demo\\src\\widget.mjs (2 cambios)");
  assert.deepEqual(multi.data.edits, [
    { oldText: "uno", newText: "dos" },
    { oldText: "tres", newText: "cuatro" }
  ]);

  assert.deepEqual(steps[7].data, { command: "node --test", output: "Command: node --test\nOutput:\npass 4\n", exitCode: null });

  const memory = steps[8];
  assert.equal(memory.tool, "mem_save");
  assert.equal(memory.data.action, "save");
  assert.equal(memory.data.title, "Widget steps");
  assert.equal(memory.data.memoryType, "decision");
  assert.equal(memory.data.content, "se guardan pasos");
  assert.equal(memory.data.results, "saved");

  assert.equal(steps[9].tool, "fetch/get_url");
  assert.equal(steps[9].data.server, "fetch");
  assert.equal(steps[9].data.name, "get_url");
  assert.equal(steps[9].data.result, "ok");

  assert.equal(steps[10].title, "plan");
  assert.equal(steps[10].data.result, null);
  assert.equal(steps[10].data.params.text, "write the report");

  assert.equal(steps[11].data.text, "Listo, quedó todo andando.");
  assert.equal(steps[11].title, "Listo, quedó todo andando.");

  assert.deepEqual(
    mapAgyBrainSteps(entries, CTX).map((step) => step.id),
    steps.map((step) => step.id),
    "the same source maps to the same ids"
  );
});

test("antigravity reads the brain format only when the worker says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-brain-adapt-"));
  const file = path.join(dir, "transcript.jsonl");
  fs.copyFileSync(path.join(fixtures, "agy-brain-transcript.jsonl"), file);

  const result = await agyActivity({ name: "x", activityFile: file, activityFormat: "brain" }, CTX);
  assert.ok(result.events.length > 0);
  assert.equal(result.notice, null);
  assert.equal(result.events.at(-1).kind, "DONE");

  const mapped = await agySteps({ name: "x", activityFile: file, activityFormat: "brain" }, CTX);
  assert.ok(mapped.steps.length > 0);
  assert.equal(mapped.notice, null);

  const none = await agyActivity({ name: "x" }, CTX);
  assert.deepEqual(none, { events: [], notice: "sin actividad visible" });
});
