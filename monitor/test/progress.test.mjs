import test from "node:test";
import assert from "node:assert/strict";

import { progressFromEntries as claudeProgress } from "../adapters/claude-code.mjs";
import { progressFromEntries as codexProgress } from "../adapters/codex.mjs";
import { progressFromMessages } from "../adapters/opencode.mjs";
import {
  buildProgress,
  formatProgressRemaining,
  idleText,
  normalizeTodos,
  progressPace,
  withActivityProgress
} from "../lib/progress.mjs";

const MINUTE = 60 * 1000;
const NOW = new Date("2026-10-03T12:00:00Z");

test("normalizeTodos maps the three states and drops cancelled or unknown ones", () => {
  const items = normalizeTodos([
    { content: "hecho", status: "completed" },
    { content: "en curso", status: "in_progress" },
    { content: "pendiente", status: "pending" },
    { content: "cancelado", status: "cancelled" },
    { content: "raro", status: "whatever" },
    { content: "sin estado" },
    { status: "pending" },
    null
  ]);
  assert.deepEqual(items, [
    { text: "hecho", status: "done" },
    { text: "en curso", status: "doing" },
    { text: "pendiente", status: "todo" }
  ]);
});

test("normalizeTodos reads the text from step or text and caps it at 120 chars", () => {
  const long = "x".repeat(150);
  assert.deepEqual(normalizeTodos([{ step: "paso codex", status: "completed" }]), [
    { text: "paso codex", status: "done" }
  ]);
  assert.deepEqual(normalizeTodos([{ text: "texto suelto", status: "pending" }]), [
    { text: "texto suelto", status: "todo" }
  ]);
  const capped = normalizeTodos([{ content: `  ${long}  `, status: "pending" }]);
  assert.equal(capped[0].text.length, 120);
  assert.deepEqual(normalizeTodos([{ content: "   ", status: "pending" }]), []);
  assert.deepEqual(normalizeTodos(null), []);
});

test("buildProgress picks the first doing item, then the first todo, and counts", () => {
  const progress = buildProgress({
    todos: [
      { content: "uno", status: "completed" },
      { content: "dos", status: "pending" },
      { content: "tres", status: "pending" }
    ],
    firstAt: "2026-10-03T11:00:00Z",
    lastStepAt: "2026-10-03T11:30:00Z"
  });
  assert.equal(progress.done, 1);
  assert.equal(progress.total, 3);
  assert.equal(progress.current, "dos");
  assert.equal(progress.firstAt, "2026-10-03T11:00:00.000Z");
  assert.equal(progress.lastStepAt, "2026-10-03T11:30:00.000Z");

  const doing = buildProgress({
    todos: [{ content: "ahora", status: "in_progress" }, { content: "despues", status: "pending" }]
  });
  assert.equal(doing.current, "ahora");
  assert.equal(doing.firstAt, null);

  const empty = buildProgress({ todos: [] });
  assert.deepEqual(empty, { items: [], done: 0, total: 0, current: null, firstAt: null, lastStepAt: null });
});

test("opencode todowrite progresses from the latest call and dates the first", () => {
  const messages = [
    {
      info: { id: "m1", time: { created: 1759485600000, completed: 1759485601000 } },
      parts: [
        {
          id: "t1",
          type: "tool",
          tool: "todowrite",
          state: {
            status: "completed",
            input: {
              todos: [
                { content: "primero", status: "completed" },
                { content: "segundo", status: "pending" }
              ]
            }
          }
        }
      ]
    },
    {
      info: { id: "m2", time: { created: 1759485720000, completed: 1759485721000 } },
      parts: [
        {
          id: "t2",
          type: "tool",
          tool: "todowrite",
          state: {
            status: "completed",
            input: {
              todos: [
                { content: "primero", status: "completed" },
                { content: "segundo", status: "completed" },
                { content: "tercero", status: "in_progress" },
                { content: "viejo", status: "cancelled" }
              ]
            }
          }
        }
      ]
    }
  ];
  const { progress, lastStepAt } = progressFromMessages(messages);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, 3, "the latest call wins and cancelled items are dropped");
  assert.equal(progress.current, "tercero");
  assert.equal(progress.firstAt, new Date(1759485601000).toISOString());
  assert.equal(progress.lastStepAt, new Date(1759485721000).toISOString());
  assert.equal(lastStepAt, new Date(1759485721000).toISOString());

  const none = progressFromMessages([{ info: { time: { created: 1 } }, parts: [{ type: "text", text: "hola" }] }]);
  assert.equal(none.progress, null);
  assert.equal(none.lastStepAt, new Date(1).toISOString());
});

test("claude TodoWrite progresses from the latest call, ignoring other tools", () => {
  const entries = [
    { type: "assistant", timestamp: "2026-10-04T10:00:00Z", message: { content: [{ type: "tool_use", id: "a", name: "Read", input: { file_path: "x" } }] } },
    {
      type: "assistant",
      timestamp: "2026-10-04T10:01:00Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "b",
            name: "TodoWrite",
            input: { todos: [{ content: "uno", status: "completed" }, { content: "dos", status: "in_progress" }] }
          }
        ]
      }
    },
    {
      type: "assistant",
      timestamp: "2026-10-04T10:02:00Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "c",
            name: "todowrite",
            input: { todos: [{ content: "uno", status: "completed" }, { content: "dos", status: "completed" }] }
          }
        ]
      }
    },
    { type: "assistant", timestamp: "2026-10-04T10:03:00Z", message: { content: [{ type: "text", text: "listo" }] } }
  ];
  const { progress, lastStepAt } = claudeProgress(entries);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, 2);
  assert.equal(progress.current, null);
  assert.equal(progress.firstAt, "2026-10-04T10:01:00.000Z");
  assert.equal(progress.lastStepAt, "2026-10-04T10:03:00.000Z");
  assert.equal(lastStepAt, "2026-10-04T10:03:00.000Z");

  assert.deepEqual(claudeProgress([{ type: "assistant", timestamp: "2026-10-04T10:00:00Z", message: { content: [] } }]), {
    progress: null,
    lastStepAt: "2026-10-04T10:00:00.000Z"
  });
});

test("codex update_plan progresses from rollout calls, kit-log function calls and exec programs", () => {
  const rollout = [
    {
      timestamp: "2026-10-05T10:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        call_id: "p1",
        arguments: JSON.stringify({
          plan: [
            { step: "revisar", status: "completed" },
            { step: "implementar", status: "in_progress" },
            { step: "probar", status: "pending" }
          ]
        })
      }
    },
    {
      timestamp: "2026-10-05T10:05:00.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "plan",
        call_id: "p2",
        input: JSON.stringify({
          steps: [
            { step: "revisar", status: "completed" },
            { step: "implementar", status: "completed" },
            { step: "probar", status: "in_progress" }
          ]
        })
      }
    }
  ];
  const { progress, lastStepAt } = codexProgress(rollout);
  assert.equal(progress.done, 2, "the latest update_plan wins");
  assert.equal(progress.total, 3);
  assert.equal(progress.current, "probar");
  assert.equal(progress.firstAt, "2026-10-05T10:00:00.000Z");
  assert.equal(lastStepAt, "2026-10-05T10:05:00.000Z");

  const log = [
    {
      type: "item.completed",
      item: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({ plan: [{ step: "uno", status: "completed" }, { step: "dos", status: "pending" }] })
      }
    }
  ];
  const fallbackTime = "2026-10-05T11:00:00.000Z";
  const fromLog = codexProgress(log, { fallbackTime });
  assert.equal(fromLog.progress.done, 1);
  assert.equal(fromLog.progress.current, "dos");
  assert.equal(fromLog.progress.firstAt, fallbackTime, "the kit log dates entries with the file mtime");
  assert.equal(fromLog.lastStepAt, fallbackTime);

  const embedded = [
    {
      timestamp: "2026-10-05T10:10:00.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "e1",
        input: 'text(await tools.update_plan({plan:[{step:"a",status:"pending"},{step:"b",status:"completed"}]}));'
      }
    }
  ];
  const fromExec = codexProgress(embedded);
  assert.equal(fromExec.progress.total, 2);
  assert.equal(fromExec.progress.done, 1);

  assert.deepEqual(codexProgress([]), { progress: null, lastStepAt: null });
  assert.deepEqual(
    codexProgress([{ timestamp: "2026-10-05T10:00:00.000Z", type: "response_item", payload: { type: "function_call", name: "wait", arguments: "{}" } }]),
    { progress: null, lastStepAt: "2026-10-05T10:00:00.000Z" }
  );
});

test("progressPace falls back to the existing remaining text without a usable list", () => {
  const etaEnd = new Date(NOW.getTime() + 30 * MINUTE);
  const fallback = "~0:30";
  assert.deepEqual(progressPace({ progress: null, etaEnd, now: NOW }), { remainingText: "~0:30", pace: null });
  assert.deepEqual(progressPace({ progress: null, etaEnd: null, now: NOW }), { remainingText: "", pace: null });

  const zero = buildProgress({ todos: [{ content: "a", status: "pending" }], firstAt: NOW.toISOString() });
  assert.deepEqual(progressPace({ progress: zero, etaEnd, now: NOW }), { remainingText: fallback, pace: null });

  const doneZero = buildProgress({ todos: [{ content: "a", status: "in_progress" }], firstAt: NOW.toISOString() });
  assert.equal(doneZero.done, 0);
  assert.deepEqual(progressPace({ progress: doneZero, etaEnd, now: NOW }), { remainingText: fallback, pace: null });

  const custom = progressPace({ progress: null, etaEnd, now: NOW, fallbackText: "esperando" });
  assert.deepEqual(custom, { remainingText: "esperando", pace: null });
});

test("progressPace measures the remaining time and compares it with the eta", () => {
  const progress = buildProgress({
    todos: [
      { content: "uno", status: "completed" },
      { content: "dos", status: "completed" },
      { content: "tres", status: "pending" },
      { content: "cuatro", status: "pending" }
    ],
    firstAt: new Date(NOW.getTime() - 60 * MINUTE).toISOString()
  });
  // rate = 60m / 2 done = 30m per item; 2 left -> projectedEnd = NOW + 60m.
  const onTime = progressPace({ progress, etaEnd: new Date(NOW.getTime() + 60 * MINUTE), now: NOW });
  assert.deepEqual(onTime, { remainingText: "~1:00 h", pace: "en hora" });

  const ahead = progressPace({ progress, etaEnd: new Date(NOW.getTime() + 90 * MINUTE), now: NOW });
  assert.equal(ahead.pace, "adelantado");
  assert.equal(ahead.remainingText, "~1:00 h");

  const late = progressPace({ progress, etaEnd: new Date(NOW.getTime() + 30 * MINUTE), now: NOW });
  assert.equal(late.pace, "demorado");

  const noEta = progressPace({ progress, etaEnd: null, now: NOW });
  assert.deepEqual(noEta, { remainingText: "~1:00 h", pace: null });

  const soon = progressPace({
    progress: buildProgress({
      todos: [
        { content: "uno", status: "completed" },
        { content: "dos", status: "completed" },
        { content: "tres", status: "pending" }
      ],
      firstAt: new Date(NOW.getTime() - 9 * MINUTE - 4000).toISOString()
    }),
    etaEnd: null,
    now: NOW
  });
  assert.equal(soon.remainingText, "~4:32", "below an hour the estimate reads m:ss");
});

test("progressPace reads listo when the whole list is done", () => {
  const progress = buildProgress({
    todos: [
      { content: "uno", status: "completed" },
      { content: "dos", status: "completed" }
    ],
    firstAt: new Date(NOW.getTime() - 60 * MINUTE).toISOString()
  });
  assert.deepEqual(progressPace({ progress, etaEnd: new Date(NOW.getTime() + 60 * MINUTE), now: NOW }), {
    remainingText: "listo",
    pace: "adelantado"
  });
  assert.deepEqual(progressPace({ progress, etaEnd: null, now: NOW }), { remainingText: "listo", pace: null });
});

test("a progress projected past its eta reads demorado with the measured time", () => {
  const progress = buildProgress({
    todos: [
      { content: "uno", status: "completed" },
      { content: "dos", status: "pending" }
    ],
    firstAt: new Date(NOW.getTime() - 120 * MINUTE).toISOString()
  });
  const result = progressPace({ progress, etaEnd: new Date(NOW.getTime() - 30 * MINUTE), now: NOW });
  assert.equal(result.remainingText, "~2:00 h");
  assert.equal(result.pace, "demorado");
});

test("formatProgressRemaining stays short below an hour and uses h above it", () => {
  assert.equal(formatProgressRemaining(45000), "~0:45");
  assert.equal(formatProgressRemaining(272000), "~4:32");
  assert.equal(formatProgressRemaining(3599000), "~59:59");
  assert.equal(formatProgressRemaining(3600000), "~1:00 h");
  assert.equal(formatProgressRemaining(90 * MINUTE), "~1:30 h");
  assert.equal(formatProgressRemaining(25 * 3600000), "~25:00 h");
  assert.equal(formatProgressRemaining(0), "~0:00");
  assert.equal(formatProgressRemaining(-5000), "~0:00");
  assert.equal(formatProgressRemaining(null), "~0:00");
});

test("idleText warns from five minutes of no movement, rounding down", () => {
  const at = (minutes, seconds = 0) => new Date(NOW.getTime() - minutes * MINUTE - seconds * 1000).toISOString();
  assert.equal(idleText({ lastStepAt: at(4, 59), now: NOW }), null);
  assert.equal(idleText({ lastStepAt: at(5), now: NOW }), "sin movimiento hace 5 min");
  assert.equal(idleText({ lastStepAt: at(59), now: NOW }), "sin movimiento hace 59 min");
  assert.equal(idleText({ lastStepAt: at(0), now: NOW }), null);
  assert.equal(idleText({ lastStepAt: null, now: NOW }), null);
  assert.equal(idleText({ lastStepAt: "not a date", now: NOW }), null);
  assert.equal(idleText({}), null);
});

test("withActivityProgress adds only the fields that carry data", () => {
  assert.deepEqual(withActivityProgress({ events: [], notice: "x" }, null, null), { events: [], notice: "x" });
  const progress = buildProgress({ todos: [{ content: "a", status: "pending" }] });
  const out = withActivityProgress({ events: [], notice: null }, progress, "2026-10-03T12:00:00.000Z");
  assert.equal(out.progress, progress);
  assert.equal(out.lastStepAt, "2026-10-03T12:00:00.000Z");
});
