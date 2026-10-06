import test from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_MS,
  MAX_TABS,
  MAX_TERMINAL_LINES,
  MAX_TOOL_LINES,
  MIN_CHARS_PER_FRAME,
  THINKING_MAX_CHARS,
  TYPING_MAX_MS,
  ansi256To16,
  ansiLines,
  capTerminalLines,
  catchUpCount,
  formatElapsed,
  highlight,
  highlightPath,
  init,
  isFinishedWorker,
  languageForPath,
  memoryProse,
  memoryResultRows,
  parseAnsi,
  pollSince,
  splitThinkingText,
  splitToolName,
  stepSignature,
  stepBlocks,
  stepTabKey,
  stepTabLabel,
  typingPlan,
  upsertTab,
  viewerFor
} from "../public/js/live-view.mjs";

function step(id, type, path, data = {}, extra = {}) {
  return { id, type, tool: extra.tool ?? type, status: extra.status ?? "done", ...(path ? { path } : {}), title: extra.title ?? "", data, ...extra };
}

function kindsOf(tokens) {
  return tokens.map((token) => token.kind);
}

function joined(tokens) {
  return tokens.map((token) => token.text).join("");
}

test("tab keys group file steps by path and keep commands, memory and tools apart", () => {
  const write = step("s1", "write", "C:\\Repo\\src\\a.ts", { content: "x" });
  const edit = step("s2", "edit", "c:/repo/src/A.TS", { newText: "y" });
  const read = step("s3", "read", "C:\\Repo\\src\\a.ts");
  assert.equal(stepTabKey(write), stepTabKey(edit));
  assert.equal(stepTabKey(write), stepTabKey(read));

  const other = step("s4", "write", "C:\\Repo\\src\\b.ts", { content: "z" });
  assert.notEqual(stepTabKey(write), stepTabKey(other));

  const first = step("s5", "command", null, { command: "node --test" });
  const second = step("s6", "command", null, { command: "node --test" });
  assert.notEqual(stepTabKey(first), stepTabKey(second));

  const save = step("s7", "memory", null, { action: "save", title: "nota" });
  const search = step("s8", "memory", null, { action: "search", title: "nota" });
  assert.notEqual(stepTabKey(save), stepTabKey(search));

  const message = step("s9", "message", null, { text: "hola" });
  const message2 = step("s10", "message", null, { text: "chau" });
  assert.equal(stepTabKey(message), stepTabKey(message2));

  const tool = step("s11", "tool", null, { name: "task" });
  const tool2 = step("s12", "tool", null, { name: "task" });
  assert.notEqual(stepTabKey(tool), stepTabKey(tool2));

  assert.equal(stepTabLabel(write), "a.ts");
  assert.match(stepTabLabel(first), /^\$ node --test/);
  assert.equal(stepTabLabel(save), "mem: nota");
  assert.equal(stepTabLabel(message), "mensajes");
});

test("upsertTab updates the same key in place and caps the strip at 12 tabs", () => {
  let tabs = [];
  const first = step("s0", "write", "C:\\repo\\f0.ts", { content: "a" });
  tabs = upsertTab(tabs, first, stepTabKey(first));
  assert.equal(tabs.length, 1);
  tabs = upsertTab(tabs, step("s1", "edit", "C:\\repo\\f0.ts", { newText: "b" }), stepTabKey(first));
  assert.equal(tabs.length, 1, "an updated file shares its tab");
  assert.equal(tabs[0].status, "done");

  for (let index = 1; index < MAX_TABS; index += 1) {
    const next = step(`s${index + 1}`, "write", `C:\\repo\\f${index}.ts`, { content: "x" });
    tabs = upsertTab(tabs, next, stepTabKey(next));
  }
  assert.equal(tabs.length, MAX_TABS);
  const overflow = step("s99", "write", "C:\\repo\\f-new.ts", { content: "x" });
  tabs = upsertTab(tabs, overflow, stepTabKey(overflow));
  assert.equal(tabs.length, MAX_TABS);
  assert.equal(tabs.some((tab) => tab.key === stepTabKey(first)), false, "the oldest tab is dropped");
  assert.equal(tabs[tabs.length - 1].key, stepTabKey(overflow));
});

test("upsertTab never drops the pinned tab", () => {
  let tabs = [];
  for (let index = 0; index < MAX_TABS; index += 1) {
    const next = step(`s${index}`, "write", `C:\\repo\\p${index}.ts`, { content: "x" });
    tabs = upsertTab(tabs, next, stepTabKey(next));
  }
  const pinnedKey = tabs[0].key;
  const overflow = step("s99", "write", "C:\\repo\\p-new.ts", { content: "x" });
  tabs = upsertTab(tabs, overflow, pinnedKey);
  assert.equal(tabs.length, MAX_TABS);
  assert.equal(tabs.some((tab) => tab.key === pinnedKey), true);
  assert.equal(tabs.some((tab) => tab.key === stepTabKey(step("s1", "write", "C:\\repo\\p1.ts", { content: "x" }))), false);
});

test("every thinking step shares one pensando tab", () => {
  const running = step("t1", "thinking", null, { text: "", startedAt: 1, endedAt: null }, { status: "running" });
  const done = step("t2", "thinking", null, { text: "listo", startedAt: 1, endedAt: 2 }, { status: "done" });
  assert.equal(stepTabKey(running), "thinking");
  assert.equal(stepTabKey(done), "thinking");
  assert.equal(stepTabLabel(running), "pensando");
  assert.equal(stepTabLabel(done), "pensando");

  let tabs = upsertTab([], running, "thinking");
  tabs = upsertTab(tabs, done, "thinking");
  assert.equal(tabs.length, 1, "the running step and its finished version share the tab");
});

test("typing plan caps a step at about 3 s and keeps at least 2 chars per frame", () => {
  const small = typingPlan(10);
  assert.ok(small.charsPerFrame >= MIN_CHARS_PER_FRAME);
  assert.ok(small.durationMs <= TYPING_MAX_MS);
  const long = typingPlan(200000);
  assert.ok(long.charsPerFrame >= MIN_CHARS_PER_FRAME);
  assert.ok(long.durationMs <= TYPING_MAX_MS + FRAME_MS, `duration ${long.durationMs}`);
  assert.ok(typingPlan(40000).durationMs <= TYPING_MAX_MS);
  assert.equal(typingPlan(0).frames, 0);
  assert.equal(typingPlan(0).durationMs, 0);
});

test("catch-up finishes the older steps only when more than 5 are waiting", () => {
  assert.equal(catchUpCount(0), 0);
  assert.equal(catchUpCount(5), 0);
  assert.equal(catchUpCount(6), 1);
  assert.equal(catchUpCount(12), 7);
});

test("the elapsed formatter keeps minutes uncapped", () => {
  assert.equal(formatElapsed(5000), "0:05");
  assert.equal(formatElapsed(155000), "2:35");
  assert.equal(formatElapsed(3660000), "61:00");
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(null), "0:00");
  assert.equal(formatElapsed(-1000), "0:00", "a clock skew never shows a negative time");
});

test("long reasoning splits at the 4000-character typing cap", () => {
  assert.equal(THINKING_MAX_CHARS, 4000);
  const long = "x".repeat(4500);
  const split = splitThinkingText(long);
  assert.equal(split.visible.length, THINKING_MAX_CHARS);
  assert.equal(split.hidden.length, 500);
  assert.equal(split.visible + split.hidden, long);

  assert.deepEqual(splitThinkingText("hola"), { visible: "hola", hidden: "" });
  assert.deepEqual(splitThinkingText(""), { visible: "", hidden: "" });
  assert.deepEqual(splitThinkingText(null), { visible: "", hidden: "" });
  assert.equal(splitThinkingText("abcdef", 3).hidden, "def");
});

test("the highlighter marks comments, strings, numbers, keywords and functions per family", () => {
  const families = [
    ["js", "// c\nconst n = 42;\nfunction go() { return \"ok\"; }", ["comment", "keyword", "number", "string", "function"]],
    ["json", "{\"a\": 1, \"b\": true}", ["string", "number", "keyword"]],
    ["css", "/* c */ @media screen { .a { width: 10px; } }", ["comment", "keyword", "number"]],
    ["html", "<!-- c --><div class=\"a\">hola</div>", ["comment", "string", "keyword"]],
    ["markdown", "# Titulo\n\n**negrita** y `codigo`", ["keyword", "string"]],
    ["powershell", "# c\n$name = \"x\"\nGet-Item -Path .", ["comment", "string", "keyword", "function"]],
    ["python", "# c\ndef go(x):\n    return \"ok\"", ["comment", "keyword", "string", "function"]],
    ["shell", "# c\nif [ -f \"$f\" ]; then grep x; fi", ["comment", "string", "keyword"]]
  ];
  for (const [language, source, expected] of families) {
    const tokens = highlight(source, language);
    assert.equal(joined(tokens), source, `${language}: tokens keep the whole text`);
    const kinds = new Set(kindsOf(tokens));
    for (const kind of expected) assert.ok(kinds.has(kind), `${language} highlights ${kind}`);
  }
});

test("the language comes from the extension and unknown ones stay plain", () => {
  assert.equal(languageForPath("a.ts"), "js");
  assert.equal(languageForPath("a.MJS"), "js");
  assert.equal(languageForPath("a.json"), "json");
  assert.equal(languageForPath("a.css"), "css");
  assert.equal(languageForPath("a.html"), "html");
  assert.equal(languageForPath("a.md"), "markdown");
  assert.equal(languageForPath("a.ps1"), "powershell");
  assert.equal(languageForPath("a.py"), "python");
  assert.equal(languageForPath("a.sh"), "shell");
  assert.equal(languageForPath("a.bin"), "plain");
  assert.equal(languageForPath("Makefile"), "plain");

  assert.deepEqual(highlight("hola", "plain"), [{ text: "hola", kind: "plain" }]);
  assert.deepEqual(highlightPath("hola", "a.unknownext"), [{ text: "hola", kind: "plain" }]);
});

test("stepBlocks describe each step type for the replay", () => {
  const write = stepBlocks(step("s1", "write", "C:\\repo\\a.ts", { content: "const a = 1;" }));
  assert.equal(write.length, 1);
  assert.equal(write[0].kind, "code");
  assert.equal(write[0].lang, "js");
  assert.equal(write[0].text, "const a = 1;");

  const edit = stepBlocks(step("s2", "edit", "C:\\repo\\a.ts", { oldText: "uno", newText: "dos" }));
  assert.deepEqual(edit.map((block) => block.kind), ["removed", "added"]);
  assert.equal(edit[0].text, "uno");
  assert.equal(edit[1].text, "dos");

  const multi = stepBlocks(
    step("s3", "edit", "C:\\repo\\a.ts", {
      edits: [
        { oldText: "1", newText: "2" },
        { oldText: "3", newText: "4" }
      ]
    })
  );
  assert.deepEqual(multi.map((block) => block.kind), ["removed", "added", "removed", "added"]);
  assert.deepEqual(multi.map((block) => block.label), ["antes (1/2)", "después (1/2)", "antes (2/2)", "después (2/2)"]);

  const read = stepBlocks(step("s4", "read", "C:\\repo\\a.ts", {}));
  assert.equal(read.length, 1);
  assert.equal(read[0].kind, "scan");
  assert.match(read[0].text, /a\.ts/);

  const message = stepBlocks(step("s5", "message", null, { text: "hola" }));
  assert.deepEqual(message, [{ kind: "text", label: null, text: "hola" }]);

  const command = stepBlocks(step("s6", "command", null, { command: "node --test", output: "pass 1" }));
  assert.deepEqual(command.map((block) => block.label), ["comando", "salida"]);
  assert.equal(command[0].lang, "shell");
  assert.equal(command[1].text, "pass 1");

  const memory = stepBlocks(step("s7", "memory", null, { action: "save", title: "nota", content: "cuerpo", query: "buscar" }));
  assert.deepEqual(memory.map((block) => block.kind), ["text", "text", "code", "code"]);
  assert.equal(memory[1].text, "nota");
  assert.equal(memory[3].text, "buscar");

  const tool = stepBlocks(step("s8", "tool", null, { name: "task", params: { a: 1 }, result: "ok" }));
  assert.equal(tool[0].text, "task");
  assert.match(tool[1].text, /"a": 1/);

  const truncated = stepBlocks({ ...step("s9", "message", null, { text: "hola" }), truncated: true });
  assert.equal(truncated[truncated.length - 1].kind, "notice");
  assert.equal(truncated[truncated.length - 1].text, "contenido recortado");

  const running = stepBlocks(step("s10", "write", "C:\\repo\\a.ts", {}, { status: "running" }));
  assert.deepEqual(running, []);
});

const PLAIN = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };

test("parseAnsi keeps plain text and applies the 16-colour SGR codes", () => {
  assert.deepEqual(parseAnsi("hola"), [{ text: "hola", ...PLAIN }]);
  const segments = parseAnsi("\u001b[31mrojo\u001b[0m y \u001b[92mbrillante\u001b[39m");
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], { text: "rojo", ...PLAIN, fg: 1 });
  assert.deepEqual(segments[1], { text: " y ", ...PLAIN });
  assert.deepEqual(segments[2], { text: "brillante", ...PLAIN, fg: 10 });
  assert.equal(parseAnsi("\u001b[mX")[0].fg, null, "an empty SGR is a reset");
  assert.equal(parseAnsi("").length, 0);
});

test("parseAnsi handles bold, dim, italic, underline and their resets", () => {
  const segments = parseAnsi("\u001b[1;3;4mX\u001b[22mY\u001b[23mZ\u001b[24mW");
  assert.deepEqual(
    segments.map((segment) => [segment.text, segment.bold, segment.dim, segment.italic, segment.underline]),
    [
      ["X", true, false, true, true],
      ["Y", false, false, true, true],
      ["Z", false, false, false, true],
      ["W", false, false, false, false]
    ]
  );
  const dim = parseAnsi("\u001b[2mdim\u001b[22mnormal");
  assert.equal(dim[0].dim, true);
  assert.equal(dim[1].dim, false);
});

test("parseAnsi applies background colours and maps 256-colour codes to the 16 slots", () => {
  const segments = parseAnsi("\u001b[44mazul\u001b[104mclaro\u001b[49mfin");
  assert.equal(segments[0].bg, 4);
  assert.equal(segments[1].bg, 12);
  assert.equal(segments[2].bg, null);

  assert.equal(parseAnsi("\u001b[38;5;196mX")[0].fg, 9, "pure red 196 is bright red");
  assert.equal(parseAnsi("\u001b[38;5;46mX")[0].fg, 10, "pure green 46 is bright green");
  assert.equal(parseAnsi("\u001b[48;5;21mX")[0].bg, 4, "pure blue 21 is the normal blue slot");
  assert.equal(parseAnsi("\u001b[38;5;240mX")[0].fg, 8, "grey 240 is the dark grey slot");
  assert.equal(parseAnsi("\u001b[38;5;9mX")[0].fg, 9, "0..15 map to themselves");
  assert.equal(ansi256To16(300), null);
  assert.equal(ansi256To16("nope"), null);
});

test("parseAnsi strips every non-SGR escape sequence", () => {
  const segments = parseAnsi("a\u001b[2Kb\u001b[1Ac\u001b]0;title\u001b\\d\u001b[?25le\u001b");
  assert.equal(segments.map((segment) => segment.text).join(""), "abcde");
  assert.equal(segments.some((segment) => segment.text.includes("\u001b")), false);
  const unknown = parseAnsi("\u001b[5;7mX");
  assert.equal(unknown[0].text, "X", "unknown SGR codes are ignored, not shown");
});

test("ansiLines splits styled segments into lines and capTerminalLines reports the cut", () => {
  const lines = ansiLines("\u001b[31mrojo\nverde\u001b[0m");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], [{ text: "rojo", ...PLAIN, fg: 1 }]);
  assert.deepEqual(lines[1], [{ text: "verde", ...PLAIN, fg: 1 }]);
  assert.equal(MAX_TERMINAL_LINES, 400);
  assert.equal(MAX_TOOL_LINES, 200);

  const all = Array.from({ length: 500 }, (_, index) => `linea ${index}`).join("\n");
  const capped = capTerminalLines(all);
  assert.equal(capped.hidden, 100);
  assert.equal(capped.text.split("\n").length, MAX_TERMINAL_LINES);
  assert.equal(capped.text.startsWith("linea 100"), true);
  assert.deepEqual(capTerminalLines("una\ndos"), { text: "una\ndos", hidden: 0 });
  assert.equal(capTerminalLines(Array.from({ length: 10 }, () => "x").join("\n"), 3).hidden, 7);
});

test("memoryResultRows finds titled items in JSON lists and falls back to text otherwise", () => {
  assert.deepEqual(memoryResultRows('[{"id":7,"title":"Auth","type":"decision"},{"id":8,"title":"Steps"}]'), [
    { title: "Auth", type: "decision", id: 7 },
    { title: "Steps", type: null, id: 8 }
  ]);
  assert.deepEqual(memoryResultRows('{"results":[{"title":"Uno","memoryType":"pattern"}]}'), [
    { title: "Uno", type: "pattern", id: null }
  ]);
  assert.deepEqual(memoryResultRows('{"observations":[{"title":"Dos"}]}'), [{ title: "Dos", type: null, id: null }]);
  assert.deepEqual(memoryResultRows([{ title: "Top" }]), [{ title: "Top", type: null, id: null }]);

  assert.equal(memoryResultRows("texto plano"), null);
  assert.equal(memoryResultRows("Saved memory ab12"), null);
  assert.equal(memoryResultRows('{"nada":1}'), null);
  assert.equal(memoryResultRows('["sin titulo"]'), null);
  assert.equal(memoryResultRows(null), null);
});

test("splitToolName separates the mcp server prefix from the tool name", () => {
  assert.deepEqual(splitToolName("mcp__engram__mem_save"), { server: "engram", name: "mem_save" });
  assert.deepEqual(splitToolName("mcp__plugin_engram_engram__mem_search"), {
    server: "plugin_engram_engram",
    name: "mem_search"
  });
  assert.deepEqual(splitToolName("task"), { server: null, name: "task" });
  assert.deepEqual(splitToolName(""), { server: null, name: "" });
});

test("memoryProse marks the markdown bold labels and keeps the rest plain", () => {
  assert.deepEqual(memoryProse("**What**: algo\n**Why**: otra"), [
    { text: "What", label: true },
    { text: ": algo\n", label: false },
    { text: "Why", label: true },
    { text: ": otra", label: false }
  ]);
  assert.deepEqual(memoryProse("sin etiquetas"), [{ text: "sin etiquetas", label: false }]);
});

test("the viewer registry maps each step type to its dedicated viewer", () => {
  assert.equal(viewerFor({ type: "command" }), "terminal");
  assert.equal(viewerFor({ type: "memory" }), "memory");
  assert.equal(viewerFor({ type: "tool" }), "tool");
  assert.equal(viewerFor({ type: "write" }), "blocks");
  assert.equal(viewerFor({ type: "edit" }), "blocks");
  assert.equal(viewerFor({ type: "read" }), "blocks");
  assert.equal(viewerFor({ type: "message" }), "blocks");
  assert.equal(viewerFor({ type: "thinking" }), "thinking");
  assert.equal(viewerFor({ type: "unknown" }), "blocks");
  assert.equal(viewerFor(null), "blocks");
});

test("init without a DOM returns null so node can import the module", () => {
  assert.equal(init({ window: null, document: null }), null);
});

test("a running step keeps being asked for until it finishes", () => {
  const steps = new Map([
    ["a", step("a", "read", "x.ts")],
    ["b", step("b", "write", "y.ts", {}, { status: "running" })],
    ["c", step("c", "command", null, { command: "ls" })]
  ]);
  assert.equal(pollSince(["a", "b", "c"], steps), "a");
  steps.set("b", step("b", "write", "y.ts", { content: "done" }));
  assert.equal(pollSince(["a", "b", "c"], steps), "c");
  steps.set("a", step("a", "read", "x.ts", {}, { status: "running" }));
  assert.equal(pollSince(["a", "b", "c"], steps), null);
  assert.equal(pollSince([], new Map()), null);
});

test("a re-delivered step is replayed only when it changed", () => {
  const running = step("w", "write", "y.ts", {}, { status: "running" });
  const finished = step("w", "write", "y.ts", { content: "hello" });
  assert.equal(stepSignature(running), stepSignature({ ...running }));
  assert.notEqual(stepSignature(running), stepSignature(finished));
  assert.equal(stepSignature(null), "");
});
test("finished or stopped workers are shown at once, never replayed", () => {
  assert.equal(isFinishedWorker({ stateKind: "done" }), true);
  assert.equal(isFinishedWorker({ stateKind: "error" }), true);
  assert.equal(isFinishedWorker({ stateKind: "working" }), false);
  assert.equal(isFinishedWorker({ state: "waiting" }), false);
  assert.equal(isFinishedWorker(null), false);
});