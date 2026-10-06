import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  activity as claudeActivity,
  mapClaudeEntries,
  mapClaudeSteps,
  mapClaudeUsage,
  parseJsonlTail,
  readFileTail,
  usage as claudeUsage
} from "../adapters/claude-code.mjs";
import {
  mapAgyEntries,
  mapAntigravitySteps,
  activity as agyActivity,
  steps as agySteps
} from "../adapters/antigravity.mjs";
import {
  mapCodexLogLine,
  mapCodexSteps,
  mapCodexUsage,
  parseCodexPatch,
  parseRateLimitsEvent,
  parseRateLimitsFromText,
  steps as codexSteps
} from "../adapters/codex.mjs";
import { mapOpenCodeMessages, mapOpenCodeSteps, mergeOfficialUsage, sumEstimatePct } from "../adapters/opencode.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const read = (name) => fs.readFileSync(path.join(fixtures, name), "utf8");

const REPO = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo";
const WT = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo-worktrees";
const CTX = { repo: REPO, worktreeParent: WT };
const NOW = new Date("2026-10-03T12:00:00Z");

test("claude usage maps the usage file and zeroes an expired 5h window", () => {
  const fresh = mapClaudeUsage(
    { time: "2026-10-03T11:55:00Z", fiveHour: 42, weekly: 7, resetsAt: "2026-10-03T16:00:00Z" },
    NOW
  );
  assert.equal(fresh.available, true);
  assert.equal(fresh.label, "Claude");
  assert.equal(fresh.fiveHour.pct, 42);
  assert.equal(fresh.week.pct, 7);
  assert.equal(fresh.fiveHour.resetsAt, "2026-10-03T16:00:00.000Z");

  const expired = mapClaudeUsage(
    { time: "2026-10-03T06:00:00Z", fiveHour: 90, weekly: 30, resetsAt: "2026-10-03T11:00:00Z" },
    NOW
  );
  assert.equal(expired.fiveHour.pct, 0);
  assert.equal(expired.fiveHour.resetsAt, null);
  assert.equal(expired.week.pct, 30);

  const missing = mapClaudeUsage(null, NOW);
  assert.equal(missing.available, false);
  assert.match(missing.error, /sin datos/);
});

test("claude usage reports its age and dims after 30 minutes", () => {
  const fresh = mapClaudeUsage(
    { time: "2026-10-03T11:50:00Z", fiveHour: 42, weekly: 7, resetsAt: "2026-10-03T16:00:00Z" },
    NOW
  );
  assert.equal(fresh.updatedAt, "2026-10-03T11:50:00.000Z");
  assert.equal(fresh.ageMinutes, 10);
  assert.equal(fresh.stale, false);

  const old = mapClaudeUsage({ time: "2026-10-03T11:10:00Z", fiveHour: 42, weekly: 7 }, NOW);
  assert.equal(old.ageMinutes, 50);
  assert.equal(old.stale, true);

  const byMtime = mapClaudeUsage({ fiveHour: 10, weekly: 2 }, NOW, {
    mtimeMs: NOW.getTime() - 5 * 60000
  });
  assert.equal(byMtime.ageMinutes, 5);
  assert.equal(byMtime.stale, false);

  const noTime = mapClaudeUsage({ fiveHour: 10, weekly: 2 }, NOW);
  assert.equal(noTime.updatedAt, null);
  assert.equal(noTime.ageMinutes, null);
  assert.equal(noTime.stale, false);
});

test("claude usage() falls back to the file mtime for the age", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-usage-"));
  const file = path.join(dir, "claude-usage.json");
  fs.writeFileSync(file, JSON.stringify({ fiveHour: 33, weekly: 9 }));
  const mtime = new Date(NOW.getTime() - 12 * 60000);
  fs.utimesSync(file, mtime, mtime);

  const mapped = await claudeUsage({ config: { claude: { usageFile: file } }, now: NOW });
  assert.equal(mapped.available, true);
  assert.equal(mapped.fiveHour.pct, 33);
  assert.equal(Math.round(mapped.ageMinutes), 12);
  assert.equal(mapped.stale, false);

  const missing = await claudeUsage({ config: { claude: { usageFile: path.join(dir, "nope.json") } }, now: NOW });
  assert.equal(missing.available, false);
  assert.match(missing.error, /no se pudo leer/);
});

test("claude transcript tail maps to normalized events with a token total", () => {
  const entries = parseJsonlTail(read("claude-transcript.jsonl"));
  const events = mapClaudeEntries(entries, CTX);

  assert.deepEqual(
    events.map((e) => `${e.kind} ${e.detail}`),
    [
      "MSG Arranco leyendo el adapter.",
      "READ tools\\fleet-monitor\\adapters\\claude-code.mjs",
      "EDIT tools\\fleet-monitor\\lib\\state.mjs",
      "CMD node --test tools/fleet-monitor/test/adapters.test.mjs",
      'COMMIT git commit -m "feat(fleet-monitor): tail claude transcripts"',
      "READ activityFile",
      "ERR Grep: no matches found",
      "DONE tokens 4790"
    ]
  );
  assert.equal(events[0].time, "2026-10-04T10:00:05.000Z");
  assert.equal(events.at(-1).time, "2026-10-04T10:00:41.000Z");
});

test("parseJsonlTail keeps the last lines and skips malformed ones", () => {
  const lines = [];
  for (let i = 0; i < 250; i += 1) lines.push(JSON.stringify({ type: "assistant", n: i }));
  lines.splice(100, 0, "this line is not json");
  const entries = parseJsonlTail(lines.join("\n"), 200);
  assert.equal(entries.length, 199);
  assert.equal(entries[0].n, 51);
  assert.equal(entries.at(-1).n, 249);
  assert.deepEqual(parseJsonlTail("broken\n{still broken", 200), []);
});

test("the transcript tail read never loads the whole file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tail-"));
  const file = path.join(dir, "transcript.jsonl");
  const padding = Array.from({ length: 400 }, () => JSON.stringify({ pad: "x".repeat(1024) })).join("\n");
  fs.writeFileSync(file, `${JSON.stringify({ marker: "head" })}\n${padding}\n${JSON.stringify({ marker: "tail" })}\n`);

  const text = readFileTail(file, 4096);
  assert.match(text, /"tail"/);
  assert.doesNotMatch(text, /"head"/);
  assert.ok(text.length <= 4096);

  const small = path.join(dir, "small.jsonl");
  fs.writeFileSync(small, '{"a":1}\n');
  assert.equal(readFileTail(small, 4096), '{"a":1}\n');
});

test("claude activity reads the worker activityFile and degrades quietly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-activity-"));
  const file = path.join(dir, "agent.jsonl");
  fs.writeFileSync(file, read("claude-transcript.jsonl"));

  const result = await claudeActivity({ name: "x", activityFile: file }, CTX);
  assert.ok(result.events.length > 0);
  assert.equal(result.notice, null);

  const none = await claudeActivity({ name: "x" }, CTX);
  assert.deepEqual(none, { events: [], notice: "sin actividad visible" });

  const missing = await claudeActivity({ name: "x", activityFile: path.join(dir, "nope.jsonl") }, CTX);
  assert.deepEqual(missing, { events: [], notice: "sin actividad visible" });

  const broken = path.join(dir, "broken.jsonl");
  fs.writeFileSync(broken, "not json\nstill not json\n");
  const malformed = await claudeActivity({ name: "x", activityFile: broken }, CTX);
  assert.deepEqual(malformed, { events: [], notice: "sin actividad visible" });
});

test("codex limits parse from a rollout tail", () => {
  const r = parseRateLimitsFromText(read("codex-rollout.jsonl"));
  assert.equal(r.primary.used_percent, 12.5);
  assert.equal(r.secondary.used_percent, 41);
  const mapped = mapCodexUsage(r);
  assert.equal(mapped.available, true);
  assert.equal(mapped.fiveHour.pct, 12.5);
  assert.equal(mapped.week.pct, 41);
  assert.equal(mapped.extra, "");
  assert.equal(mapped.fiveHour.resetsAt, new Date(1791200000 * 1000).toISOString());

  const warn = mapCodexUsage({
    primary: { used_percent: 87, resets_at: 1791200000 },
    secondary: { used_percent: 60, resets_at: 1791500000 },
    rate_limit_reached_type: null
  });
  assert.equal(warn.extra, "pasa a OpenCode");

  const reached = mapCodexUsage({
    primary: { used_percent: 100, resets_at: 1791200000 },
    secondary: { used_percent: 99, resets_at: 1791500000 },
    rate_limit_reached_type: "primary"
  });
  assert.equal(reached.extra, "LÍMITE ALCANZADO");

  assert.equal(parseRateLimitsFromText("no limits here"), null);
});

test("codex limits carry the age of the rollout event", () => {
  const event = parseRateLimitsEvent(read("codex-rollout.jsonl"));
  assert.equal(event.time, "2026-10-03T10:00:05.000Z");
  const mapped = mapCodexUsage(event.limits, { time: event.time, now: NOW });
  assert.equal(mapped.updatedAt, "2026-10-03T10:00:05.000Z");
  assert.equal(Math.round(mapped.ageMinutes), 120);

  const byMtime = mapCodexUsage(event.limits, { mtimeMs: NOW.getTime() - 5 * 60000, now: NOW });
  assert.equal(byMtime.ageMinutes, 5);
  assert.equal(mapCodexUsage(null, { now: NOW }).ageMinutes, null);
});

test("codex log lines map to index events like watch.ps1", () => {
  const lines = read("codex-log.jsonl").trim().split(/\r?\n/).map((l) => JSON.parse(l));
  const events = lines.flatMap((e) => mapCodexLogLine(e, CTX));

  assert.deepEqual(events[0], { kind: "CMD", detail: "git status --short" });
  assert.deepEqual(events[1], { kind: "ERR", detail: "pnpm test (exit 1)" });
  assert.deepEqual(events[2], { kind: "MSG", detail: "Listo." });
  assert.deepEqual(events[3], { kind: "EDIT", detail: "update apps\\web\\src\\a.tsx" });

  const collab = mapCodexLogLine({ type: "item.started", item: { type: "collab_tool_call", tool: "spawn" } }, CTX);
  assert.deepEqual(collab, [{ kind: "SUB", detail: "coordinando sub-agentes (spawn)" }]);
});

test("opencode message parts map to normalized events", () => {
  const messages = JSON.parse(read("opencode-messages.json"));
  const events = mapOpenCodeMessages(messages, CTX);

  assert.deepEqual(
    events.map((e) => `${e.kind} ${e.detail}`),
    [
      "CMD pnpm --filter web test",
      "EDIT apps\\web\\src\\a.tsx",
      "READ apps\\api\\src\\x.ts",
      "MSG Listo, corregi el formulario.",
      "DONE costo $0.0123  -  tokens 4567",
      "COMMIT git commit -m \"feat: x\"",
      "ERR bash: boom in the test run"
    ]
  );
  const first = events[0];
  assert.equal(first.time, new Date(1759485601000).toISOString());
  assert.equal(events[4].time, new Date(1759485601000).toISOString());
});

test("opencode official usage reports the age of its snapshot", () => {
  const merged = mergeOfficialUsage({
    official: { updatedAt: "2026-10-03T11:50:00Z", rolling: 10, weekly: 20, monthly: 5 },
    deltas: [],
    resetDeltas: [],
    now: NOW
  });
  assert.equal(merged.updatedAt, "2026-10-03T11:50:00.000Z");
  assert.equal(merged.ageMinutes, 10);

  const estimateOnly = mergeOfficialUsage({
    official: null,
    deltas: null,
    resetDeltas: [],
    now: NOW,
    estimate: { fiveHour: 12, week: 34 }
  });
  assert.equal(estimateOnly.updatedAt, null);
  assert.equal(estimateOnly.ageMinutes, null);
});

test("opencode estimate rows sum the model shares and clamp at 100", () => {
  const rows = [
    { model: "deepseek-v4.1-flash", pct: { fiveHour: 11, week: 23, month: 40 } },
    { model: "mimo-v2.6-pro", pct: { fiveHour: 5, week: 70, month: 80 } }
  ];
  assert.deepEqual(sumEstimatePct(rows), { fiveHour: 16, week: 93, month: 100 });
  assert.deepEqual(sumEstimatePct([]), { fiveHour: 0, week: 0, month: 0 });
  assert.deepEqual(sumEstimatePct(null), { fiveHour: 0, week: 0, month: 0 });
});

test("opencode official snapshot merges the local spend and warns near the cap", () => {
  const merged = mergeOfficialUsage({
    official: {
      updatedAt: "2026-10-03T11:50:00Z",
      rolling: 10,
      weekly: 20,
      monthly: 5,
      rollingResetsAt: "2026-10-03T15:00:00Z"
    },
    deltas: [{ pct: { fiveHour: 3, week: 5 } }],
    resetDeltas: [],
    now: NOW
  });
  assert.equal(merged.available, true);
  assert.equal(merged.fiveHour.pct, 13);
  assert.equal(merged.week.pct, 25);
  assert.equal(merged.extra, "");
  assert.equal(merged.fiveHour.resetsAt, "2026-10-03T15:00:00.000Z");

  const rolled = mergeOfficialUsage({
    official: {
      updatedAt: "2026-10-03T06:00:00Z",
      rolling: 90,
      weekly: 30,
      monthly: 5,
      rollingResetsAt: "2026-10-03T11:00:00Z"
    },
    deltas: [],
    resetDeltas: [{ pct: { fiveHour: 8, week: 1 } }],
    now: NOW
  });
  assert.equal(rolled.fiveHour.pct, 8);
  assert.equal(rolled.fiveHour.resetsAt, "2026-10-03T16:00:00.000Z");

  const near = mergeOfficialUsage({
    official: { updatedAt: "2026-10-03T11:50:00Z", rolling: 10, weekly: 88, monthly: 5 },
    deltas: [],
    resetDeltas: [],
    now: NOW
  });
  assert.equal(near.extra, "CERCA DEL LÍMITE");

  const onlyEstimate = mergeOfficialUsage({
    official: null,
    deltas: null,
    resetDeltas: [],
    now: NOW,
    estimate: { fiveHour: 12, week: 34 }
  });
  assert.equal(onlyEstimate.available, true);
  assert.equal(onlyEstimate.fiveHour.pct, 12);
  assert.equal(onlyEstimate.week.pct, 34);
  assert.equal(onlyEstimate.error, null);
});

test("antigravity transcript maps to normalized events with a token total", () => {
  const entries = parseJsonlTail(read("agy-stream.ndjson"));
  const events = mapAgyEntries(entries, CTX);

  assert.deepEqual(
    events.map((e) => `${e.kind} ${e.detail}`),
    [
      "READ state.mjs",
      "ERR declaring permissions: cortex tool view_file: convert tool call for permissions: model output error: invalid tool call error (invalid_args) failed to ...",
      "MSG mcp engram/mem_current_project",
      "MSG - *Note*: [`index.html`](file:///C:/Users/user/Desktop/FlotaGrupo/tools/fleet-monitor/index.html) has **zero** hard-coded engine names or colors (card colors are purely state-driven).",
      "DONE SUCCESS · tokens 212958"
    ]
  );
  assert.equal(events.at(-1).time, null);
});

test("antigravity flags denied permissions and silent empty successes", () => {
  const result = (extra) => ({ event: "result", result: { status: "SUCCESS", usage: { total_tokens: 10 }, ...extra } });

  const denied = mapAgyEntries([result({ response: "", denied_actions: [{ action: "write_file", display_name: "ReplaceFileContent" }] })], CTX);
  assert.deepEqual(denied.map((e) => `${e.kind} ${e.detail}`), ["ERR permiso denegado: write_file", "DONE SUCCESS · tokens 10"]);

  const silent = mapAgyEntries([result({ response: "  " })], CTX);
  assert.deepEqual(silent.map((e) => `${e.kind} ${e.detail}`), ["ERR terminó sin respuesta", "DONE SUCCESS · tokens 10"]);

  const ok = mapAgyEntries([result({ response: "done" })], CTX);
  assert.deepEqual(ok.map((e) => e.kind), ["DONE"]);

  const active = mapAgyEntries([{ event: "step_update", step_update: { step_type: "tool", state: "ACTIVE", tool_name: "view_file" } }], CTX);
  assert.deepEqual(active, []);
});

test("antigravity activity reads the worker activityFile and degrades quietly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-activity-"));
  const file = path.join(dir, "agent.ndjson");
  fs.writeFileSync(file, read("agy-stream.ndjson"));

  const result = await agyActivity({ name: "x", activityFile: file }, CTX);
  assert.ok(result.events.length > 0);
  assert.equal(result.notice, null);

  const none = await agyActivity({ name: "x" }, CTX);
  assert.deepEqual(none, { events: [], notice: "sin actividad visible" });

  const missing = await agyActivity({ name: "x", activityFile: path.join(dir, "nope.ndjson") }, CTX);
  assert.deepEqual(missing, { events: [], notice: "sin actividad visible" });

  const chatty = path.join(dir, "chatty.ndjson");
  const tool = JSON.stringify({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "tool", tool_name: "view_file", tool_info: { parameters: { AbsolutePath: "C:/repo/app.ts" } } } });
  const delta = JSON.stringify({ event: "step_update", step_update: { step_index: 2, state: "ACTIVE", step_type: "agent_response", text_delta: "x" } });
  fs.writeFileSync(chatty, [tool, ...Array(400).fill(delta)].join("\n"));
  const streamed = await agyActivity({ name: "x", activityFile: chatty }, CTX);
  assert.ok(streamed.events.some((e) => e.kind === "READ" && e.detail === "app.ts"), "a long streamed answer must not hide earlier tool steps");

  const broken = path.join(dir, "broken.ndjson");
  fs.writeFileSync(broken, "not json\nstill not json\n");
  const malformed = await agyActivity({ name: "x", activityFile: broken }, CTX);
  assert.deepEqual(malformed, { events: [], notice: "sin actividad visible" });
});

test("opencode message parts map to full typed steps", () => {
  const messages = JSON.parse(read("opencode-steps.json"));
  const steps = mapOpenCodeSteps(messages, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    [
      "write/done",
      "edit/done",
      "read/done",
      "read/done",
      "command/done",
      "memory/done",
      "memory/done",
      "tool/done",
      "message/done",
      "write/running",
      "command/error",
      "tool/running"
    ]
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"]
  );
  assert.equal(steps[0].time, new Date(1759485601000).toISOString());

  const write = steps[0];
  assert.equal(write.path, "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo-worktrees\\web-monitor\\apps\\web\\src\\a.tsx");
  assert.equal(write.title, "escribir apps\\web\\src\\a.tsx");
  assert.equal(write.data.content, "export const a = 1;\n");

  assert.deepEqual(steps[1].data, { oldText: "const a = 1", newText: "const a = 2" });
  assert.equal(steps[2].title, "leer apps\\api\\src\\x.ts");
  assert.equal(steps[3].title, "buscar «TODO» en apps");

  assert.deepEqual(steps[4].data, { command: "node --test", output: "pass 12\n", exitCode: 0 });

  const save = steps[5];
  assert.equal(save.type, "memory");
  assert.equal(save.tool, "engram_mem_save");
  assert.equal(save.data.action, "save");
  assert.equal(save.data.title, "Steps API");
  assert.equal(save.data.memoryType, "architecture");
  assert.equal(save.data.content, "se guardan pasos tipados");

  const search = steps[6];
  assert.equal(search.tool, "mcp__plugin_engram_engram__mem_search");
  assert.equal(search.data.action, "search");
  assert.equal(search.data.query, "typed steps");
  assert.equal(search.data.results, "[{\"id\":1}]");

  const tool = steps[7];
  assert.equal(tool.data.name, "task");
  assert.equal(tool.data.params.description, "explore the repo");
  assert.equal(tool.data.result, "done");

  assert.equal(steps[8].data.text, "Listo, corregi el formulario. Sigo con las pruebas.");
  assert.equal(steps[8].title, "Listo, corregi el formulario.");

  assert.equal(steps[10].data.output, "boom in the test run");
  assert.equal(steps[10].data.exitCode, null);
  assert.equal(steps[11].data.result, null);
});

test("claude transcript entries map to full typed steps joined by tool_use_id", () => {
  const entries = parseJsonlTail(read("claude-steps.jsonl"));
  const steps = mapClaudeSteps(entries, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    [
      "message/done",
      "write/done",
      "edit/done",
      "edit/done",
      "read/done",
      "read/done",
      "command/done",
      "command/error",
      "memory/done",
      "memory/done",
      "tool/running",
      "tool/running"
    ]
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      "text-2026-10-04T10:00:01.000Z-1",
      "toolu_w",
      "toolu_e",
      "toolu_m",
      "toolu_r",
      "toolu_g",
      "toolu_b",
      "toolu_bf",
      "toolu_ms",
      "toolu_mq",
      "toolu_t",
      "toolu_run"
    ],
    "tool ids are stable for polling"
  );

  const write = steps[1];
  assert.equal(write.title, "escribir apps\\web\\src\\a.tsx");
  assert.equal(write.data.content, "export const a = 1;\n");

  assert.deepEqual(steps[2].data, { oldText: "const a = 1", newText: "const a = 2" });

  const multi = steps[3];
  assert.equal(multi.path, "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo\\apps\\api\\src\\y.ts");
  assert.deepEqual(multi.data.edits, [
    { oldText: "1", newText: "2" },
    { oldText: "3", newText: "4" }
  ]);

  assert.equal(steps[5].title, "buscar «activityFile» en apps");
  assert.deepEqual(steps[6].data, { command: "node --test", output: "all tests pass", exitCode: 0 });

  const failed = steps[7];
  assert.equal(failed.status, "error");
  assert.equal(failed.data.output, "Exit code 1\nboom in the test run");
  assert.equal(failed.data.exitCode, 1);

  assert.equal(steps[8].data.action, "save");
  assert.equal(steps[8].data.memoryType, "decision");
  assert.equal(steps[9].data.action, "search");
  assert.equal(steps[9].data.results, "[{ \"id\": 7 }]");

  assert.equal(steps[10].title, "Task: explore the repo");
  assert.equal(steps[11].type, "tool");
  assert.equal(steps[11].data.result, null);
});

test("codex rollout items map to full typed steps joined by call_id", () => {
  const entries = parseJsonlTail(read("codex-steps.jsonl"));
  const steps = mapCodexSteps(entries, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    [
      "message/done",
      "command/done",
      "write/done",
      "edit/done",
      "tool/done",
      "memory/done",
      "command/error",
      "tool/running",
      "tool/done"
    ]
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    [
      steps[0].id,
      "call_cmd-0",
      "call_patch-0",
      "call_patch-1",
      "call_patch-2",
      "call_mem",
      "call_fail-0",
      "call_run",
      "call_plan"
    ],
    "call ids are stable for polling"
  );
  assert.match(steps[0].id, /^msg-/);
  assert.equal(steps[1].time, "2026-10-05T10:00:02.000Z");

  const command = steps[1];
  assert.deepEqual(command.data, {
    command: "git status --short",
    output: "On branch demo\nnothing to commit\nProcess exited with code 0\n",
    exitCode: 0
  });

  const write = steps[2];
  assert.equal(write.path, "docs/nuevo.md");
  assert.equal(write.title, "escribir docs/nuevo.md");
  assert.equal(write.data.content, "linea nueva\notra linea");

  assert.deepEqual(steps[3].data, { oldText: "const a = 1;\nconst b = 2;", newText: "const a = 1;\nconst b = 3;" });

  const removed = steps[4];
  assert.equal(removed.type, "tool");
  assert.equal(removed.path, "tmp/viejo.txt");
  assert.equal(removed.title, "borrado: tmp/viejo.txt");

  const memory = steps[5];
  assert.equal(memory.tool, "mcp__engram__mem_save");
  assert.equal(memory.data.action, "save");
  assert.equal(memory.data.title, "Nota de steps");
  assert.equal(memory.data.memoryType, "decision");
  assert.equal(memory.data.content, "se mapean pasos tipados");
  assert.equal(memory.data.results, "guardado");

  const failed = steps[6];
  assert.equal(failed.status, "error");
  assert.equal(failed.data.exitCode, 1);
  assert.match(failed.data.output, /boom en la corrida/);

  assert.equal(steps[7].title, "wait");
  assert.equal(steps[7].data.result, null);
  assert.equal(steps[8].data.params.steps.join(","), "uno,dos");
  assert.equal(steps[8].data.result, "ok");

  assert.deepEqual(
    mapCodexSteps(entries, CTX).map((step) => step.id),
    steps.map((step) => step.id),
    "the same source maps to the same ids"
  );
});

test("codex log events map to typed steps and skip the started twin", () => {
  const entries = parseJsonlTail(read("codex-log.jsonl"));
  const steps = mapCodexSteps(entries, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    ["command/done", "command/error", "message/done", "edit/done"]
  );
  assert.deepEqual(steps[0].data, { command: "git status --short", output: "", exitCode: 0 });
  assert.equal(steps[1].data.exitCode, 1);
  assert.equal(steps[2].title, "Listo.");
  assert.equal(steps[3].title, "editar apps\\web\\src\\a.tsx");
  assert.equal(steps[3].path, "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo-worktrees\\web-monitor\\apps\\web\\src\\a.tsx");
});

test("codex patch parsing splits add, update and delete hunks", () => {
  const files = parseCodexPatch(
    [
      "*** Begin Patch",
      "*** Add File: a.txt",
      "+uno",
      "+dos",
      "*** Update File: b.txt",
      "*** Move to: c.txt",
      "@@ seccion",
      " contexto",
      "-viejo",
      "+nuevo",
      "*** Delete File: d.txt",
      "*** End Patch"
    ].join("\n")
  );

  assert.deepEqual(files.map((file) => `${file.kind} ${file.path}`), ["add a.txt", "update b.txt", "delete d.txt"]);
  assert.equal(files[0].lines.join("\n"), "uno\ndos");
  assert.deepEqual(files[1].hunks, [{ old: ["contexto", "viejo"], new: ["contexto", "nuevo"] }]);
  assert.deepEqual(parseCodexPatch("no patch here"), []);
});

test("antigravity stream maps to full typed steps", () => {
  const entries = parseJsonlTail(read("agy-steps.ndjson"));
  const steps = mapAntigravitySteps(entries, CTX);

  assert.deepEqual(
    steps.map((step) => `${step.type}/${step.status}`),
    [
      "read/done",
      "write/done",
      "edit/done",
      "edit/done",
      "command/done",
      "memory/done",
      "tool/done",
      "tool/done",
      "command/error",
      "message/done"
    ]
  );

  const readStep = steps[0];
  assert.equal(readStep.tool, "view_file");
  assert.equal(readStep.path, "C:\\demo\\src\\app.mjs");
  assert.equal(readStep.title, "leer C:\\demo\\src\\app.mjs");

  const write = steps[1];
  assert.equal(write.title, "escribir C:\\demo\\src\\nuevo.mjs");
  assert.equal(write.data.content, "export const nuevo = true;\n");

  assert.deepEqual(steps[2].data, { oldText: "const a = 1;", newText: "const a = 2;" });

  const multi = steps[3];
  assert.equal(multi.title, "editar C:\\demo\\src\\multi.mjs (2 cambios)");
  assert.deepEqual(multi.data.edits, [
    { oldText: "uno", newText: "dos" },
    { oldText: "tres", newText: "cuatro" }
  ]);

  assert.deepEqual(steps[4].data, { command: "node --test", output: "pass 4\n", exitCode: 0 });

  const memory = steps[5];
  assert.equal(memory.tool, "mem_save");
  assert.equal(memory.data.action, "save");
  assert.equal(memory.data.memoryType, "architecture");
  assert.equal(memory.data.content, "pasos tipados");
  assert.equal(memory.data.results, "saved");

  assert.equal(steps[6].tool, "fetch/get_url");
  assert.equal(steps[6].data.server, "fetch");
  assert.equal(steps[6].data.name, "get_url");

  assert.equal(steps[7].title, "plan");

  const failed = steps[8];
  assert.equal(failed.status, "error");
  assert.equal(failed.data.command, "git add .");
  assert.equal(failed.data.output, "permiso denegado por el usuario");
  assert.equal(failed.data.exitCode, null);

  assert.equal(steps[9].data.text, "Listo, quedó todo andando.");
  assert.equal(steps[9].title, "Listo, quedó todo andando.");

  assert.deepEqual(
    mapAntigravitySteps(entries, CTX).map((step) => step.id),
    steps.map((step) => step.id),
    "the same source maps to the same ids"
  );
});

test("antigravity in-flight tools keep a running step", () => {
  const entries = [
    {
      event: "step_update",
      step_update: {
        conversation_id: "conv-live",
        step_index: 4,
        state: "ACTIVE",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: { name: "run_command", parameters: { CommandLine: "pnpm build" } }
      }
    }
  ];
  const steps = mapAntigravitySteps(entries, CTX);
  assert.deepEqual(steps.map((step) => `${step.type}/${step.status}`), ["command/running"]);
  assert.equal(steps[0].data.command, "pnpm build");
  assert.equal(steps[0].data.output, "");
});

test("the new step mappers cap text and keep the last 300 steps", () => {
  const long = "y".repeat(200001);
  const codex = mapCodexSteps(
    [
      {
        type: "response_item",
        payload: { type: "custom_tool_call", name: "apply_patch", call_id: "c1", status: "completed", input: `*** Begin Patch\n*** Add File: a.ts\n+${long}\n*** End Patch` }
      }
    ],
    CTX
  );
  assert.equal(codex[0].data.content.length, 200000);
  assert.equal(codex[0].truncated, true);

  const agy = mapAntigravitySteps(
    [
      {
        event: "step_update",
        step_update: {
          conversation_id: "c",
          step_index: 1,
          state: "DONE",
          step_type: "tool",
          tool_name: "write_to_file",
          tool_info: { name: "write_to_file", parameters: { TargetFile: "a.ts", CodeContent: long } }
        }
      }
    ],
    CTX
  );
  assert.equal(agy[0].data.content.length, 200000);
  assert.equal(agy[0].truncated, true);

  const codexMany = mapCodexSteps(
    Array.from({ length: 310 }, (_, index) => ({
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `linea ${index}` }] }
    })),
    CTX
  );
  assert.equal(codexMany.length, 300);
  assert.equal(codexMany[0].data.text, "linea 10");

  const agyMany = mapAntigravitySteps(
    Array.from({ length: 310 }, (_, index) => ({
      event: "step_update",
      step_update: {
        conversation_id: "c",
        step_index: index,
        state: "DONE",
        step_type: "tool",
        tool_name: "view_file",
        tool_info: { name: "view_file", parameters: { AbsolutePath: `C:/repo/f${index}.ts` } }
      }
    })),
    CTX
  );
  assert.equal(agyMany.length, 300);
  assert.equal(agyMany[0].path, "C:/repo/f10.ts");
});

test("codex steps() reads the kit log and degrades quietly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-steps-"));
  fs.writeFileSync(path.join(dir, "log-codex-a-2026.jsonl"), read("codex-steps.jsonl"));

  const result = await codexSteps({ name: "codex-a" }, { ...CTX, kitDir: dir });
  assert.ok(result.steps.length > 0);
  assert.equal(result.notice, null);

  const none = await codexSteps({ name: "codex-b" }, { ...CTX, kitDir: dir });
  assert.deepEqual(none, { steps: [], notice: "todavía no hay log" });

  const missing = await codexSteps({ name: "codex-a" }, { ...CTX, kitDir: path.join(dir, "nope") });
  assert.deepEqual(missing, { steps: [], notice: "sin actividad visible" });

  const malformed = path.join(dir, "log-codex-c-1.jsonl");
  fs.writeFileSync(malformed, "not json\nstill not json\n");
  const broken = await codexSteps({ name: "codex-c" }, { ...CTX, kitDir: dir });
  assert.deepEqual(broken, { steps: [], notice: "sin pasos visibles" });
});

test("antigravity steps() reads the activityFile and degrades quietly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-steps-"));
  const file = path.join(dir, "agent.ndjson");
  fs.writeFileSync(file, read("agy-steps.ndjson"));

  const result = await agySteps({ name: "x", activityFile: file }, CTX);
  assert.ok(result.steps.length > 0);
  assert.equal(result.notice, null);

  const none = await agySteps({ name: "x" }, CTX);
  assert.deepEqual(none, { steps: [], notice: "sin actividad visible" });

  const missing = await agySteps({ name: "x", activityFile: path.join(dir, "nope.ndjson") }, CTX);
  assert.deepEqual(missing, { steps: [], notice: "sin actividad visible" });

  const broken = path.join(dir, "broken.ndjson");
  fs.writeFileSync(broken, "not json\nstill not json\n");
  const malformed = await agySteps({ name: "x", activityFile: broken }, CTX);
  assert.deepEqual(malformed, { steps: [], notice: "sin pasos visibles" });
});

test("both step mappers cap text, drop binary data and keep the last 300 steps", () => {
  const long = "x".repeat(200001);
  const binary = "before\u0000after";

  const openCode = mapOpenCodeSteps(
    [
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [
          { id: "long", type: "tool", tool: "write", state: { status: "completed", input: { filePath: "a.ts", content: long } } },
          { id: "bin", type: "tool", tool: "webfetch", state: { status: "completed", input: {}, output: binary } }
        ]
      }
    ],
    CTX
  );
  assert.equal(openCode[0].data.content.length, 200000);
  assert.equal(openCode[0].truncated, true);
  assert.equal(openCode[1].data.result, "[datos binarios omitidos]");
  assert.equal(openCode[1].truncated, true);

  const claude = mapClaudeSteps(
    [
      {
        type: "assistant",
        uuid: "u1",
        timestamp: "2026-10-04T10:00:00Z",
        message: { role: "assistant", content: [{ type: "tool_use", id: "long", name: "Write", input: { file_path: "a.ts", content: long } }] }
      }
    ],
    CTX
  );
  assert.equal(claude[0].data.content.length, 200000);
  assert.equal(claude[0].truncated, true);

  const manyParts = Array.from({ length: 310 }, (_, i) => ({ id: `p${i}`, type: "text", text: `linea ${i}` }));
  const openCodeMany = mapOpenCodeSteps([{ info: { role: "assistant" }, parts: manyParts }], CTX);
  assert.equal(openCodeMany.length, 300);
  assert.equal(openCodeMany[0].id, "p10");

  const manyEntries = Array.from({ length: 310 }, (_, i) => ({
    type: "assistant",
    uuid: `u${i}`,
    timestamp: "2026-10-04T10:00:00Z",
    message: { role: "assistant", content: [{ type: "text", text: `linea ${i}` }] }
  }));
  const claudeMany = mapClaudeSteps(manyEntries, CTX);
  assert.equal(claudeMany.length, 300);
  assert.equal(claudeMany[0].data.text, "linea 10");
});

test("command output keeps ANSI color escapes but binary content is replaced", async () => {
  const { commandStep, capStep } = await import("../lib/steps.mjs");
  const colored = "\u001b[32mok\u001b[0m 3 passed";
  const step = commandStep({ id: "c1", time: null, tool: "bash", status: "done", command: "npm test", output: colored, exitCode: 0 });
  assert.equal(step.data.output, colored);
  assert.equal(step.truncated, undefined);
  const binary = capStep({ id: "b1", data: { content: "PNG\u0000\u0001\u0002" } });
  assert.equal(binary.data.content, "[datos binarios omitidos]");
  assert.equal(binary.truncated, true);
});
