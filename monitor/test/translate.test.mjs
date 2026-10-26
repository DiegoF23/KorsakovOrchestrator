import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_MODEL,
  HELPER_DIR,
  MAX_BATCH,
  applyPrefix,
  buildHelperArgs,
  cleanSummary,
  collectText,
  createTranslationService,
  parseNumberedReply
} from "../lib/translate.mjs";

function tempCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-monitor-translate-"));
  return path.join(dir, "translations.json");
}

function commit(sha, subject) {
  return { sha, shortSha: sha.slice(0, 7), subject };
}

function worker(name, events) {
  return { name, stateKind: "working", activity: { events } };
}

const KIT = { helperExe: "C:\\tools\\opencode.cmd", server: { host: "127.0.0.1", port: 4096 } };
const CONFIG = { translate: { model: "opencode-go/beam-free" } };

test("the numbered reply maps by number and tolerates quotes, dots and blank lines", () => {
  const parsed = parseNumberedReply("1\t\"Primero\"\n\n2. Segundo\n3) 'Tercero'", 3);
  assert.deepEqual(parsed, ["Primero", "Segundo", "Tercero"]);

  const partial = parseNumberedReply("2\tsolo el segundo", 3);
  assert.deepEqual(partial, [null, "solo el segundo", null]);

  const reversed = parseNumberedReply("2\tdos\n1\tuno", 2);
  assert.deepEqual(reversed, ["uno", "dos"]);

  const bare = parseNumberedReply("uno\ndos", 2);
  assert.deepEqual(bare, ["uno", "dos"]);
});

test("the conventional commit prefix always survives translation", () => {
  assert.equal(applyPrefix("feat(web): add filters", "agregar filtros"), "feat(web): agregar filtros");
  assert.equal(applyPrefix("fix(api): race", "fix(api): carrera"), "fix(api): carrera");
  assert.equal(applyPrefix("fix(api): race", "nuevo(api): carrera"), "fix(api): carrera");
  assert.equal(applyPrefix("docs: guide", "docs: guía"), "docs: guía");
  assert.equal(applyPrefix("simplify the tree", "simplificar el árbol"), "simplificar el árbol");
});

test("a summary is a single line, unquoted and hard-capped at 120 characters", () => {
  const cleaned = cleanSummary(`"${"x".repeat(200)}"`);
  assert.equal(cleaned.length, 120);
  assert.equal(cleaned.endsWith("..."), true);
  assert.equal(cleanSummary("primera\nsegunda"), "primera");
  assert.equal(cleanSummary("   "), "");
  assert.equal(cleanSummary("- Corrigiendo los tests"), "Corrigiendo los tests");
});

test("untranslated commits are batched into one numbered request and cached by sha", async () => {
  const cacheFile = tempCache();
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    const lines = request.prompt.split("\n").filter((line) => /^\d+\t/.test(line));
    return lines
      .reverse()
      .map((line) => {
        const [number, subject] = line.split("\t");
        return `${number}\ttraduccion ${subject.replace(/^feat: commit /, "")}`;
      })
      .join("\n");
  };
  const service = createTranslationService({ cacheFile, runner, now: () => 1000 });
  const commits = Array.from({ length: MAX_BATCH + 5 }, (_, i) => commit(`sha-${i}`, `feat: commit ${i}`));

  service.enrich({ git: { commits } }, { kit: KIT, config: CONFIG });
  await service.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, DEFAULT_MODEL);
  assert.equal(calls[0].server, "http://127.0.0.1:4096");
  assert.match(calls[0].prompt, /1\tfeat: commit 0/);
  assert.match(calls[0].prompt, new RegExp(`${MAX_BATCH}\\tfeat: commit ${MAX_BATCH - 1}`));
  assert.doesNotMatch(calls[0].prompt, new RegExp(`feat: commit ${MAX_BATCH}\\b`));

  service.enrich({ git: { commits } }, { kit: KIT, config: CONFIG });
  await service.flush();

  assert.equal(calls.length, 2);
  service.enrich({ git: { commits } }, { kit: KIT, config: CONFIG });
  assert.equal(commits[0].subjectEs, "feat: traduccion 0");
  assert.equal(commits[1].subjectEs, "feat: traduccion 1");
  assert.equal(commits[MAX_BATCH].subjectEs, `feat: traduccion ${MAX_BATCH}`);
  assert.equal(fs.existsSync(cacheFile), true);

  service.enrich({ git: { commits } }, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 2, "every sha is translated once");

  const cached = createTranslationService({
    cacheFile,
    runner: async () => {
      throw new Error("must not run");
    },
    now: () => 2000
  });
  const fresh = { git: { commits: [commit("sha-0", "feat: commit 0")] } };
  cached.enrich(fresh, { kit: KIT, config: CONFIG });
  await cached.flush();
  assert.equal(fresh.git.commits[0].subjectEs, "feat: traduccion 0");
});

test("the worker last commit reuses the tree translation", async () => {
  const cacheFile = tempCache();
  const runner = async () => "1\tcorregir filtros";
  const service = createTranslationService({ cacheFile, runner, now: () => 0 });
  const lastCommit = commit("abc1234", "fix(web): correct filters");
  const card = { name: "web", stateKind: "working", lastCommit, activity: { events: [] } };
  const snapshot = { workers: [card] };

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  service.enrich(snapshot, { kit: KIT, config: CONFIG });

  assert.equal(lastCommit.subjectEs, "fix(web): corregir filtros");
});

test("a failing helper keeps the English text and retries with backoff", async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    throw new Error("boom");
  };
  let clock = 1000;
  const service = createTranslationService({
    cacheFile: tempCache(),
    runner,
    now: () => clock,
    baseBackoffMs: 60_000,
    maxBackoffMs: 600_000
  });
  const snapshot = { git: { commits: [commit("a", "feat: one")] } };

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 1);
  assert.equal(snapshot.git.commits[0].subjectEs, undefined);

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 1, "no retry before the backoff elapses");

  clock += 61_000;
  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 2);
});

test("without a helper, a server or enabled translation the service stays quiet", async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    return "1\tx";
  };
  const service = createTranslationService({ cacheFile: tempCache(), runner, now: () => 0 });
  const snapshot = { git: { commits: [commit("a", "feat: one")] } };

  service.enrich(snapshot, { config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 0);

  service.enrich(snapshot, { kit: { server: { host: "127.0.0.1", port: 4096 } }, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 0);

  service.enrich(snapshot, { kit: KIT, config: { translate: { enabled: false } } });
  await service.flush();
  assert.equal(calls.length, 0);
  assert.equal(snapshot.git.commits[0].subjectEs, undefined);
});

test("a project without a kit translates through the helper named in translate config", async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    return "1\tuno";
  };
  const cacheFile = tempCache();
  const service = createTranslationService({ cacheFile, runner, now: () => 0 });
  const config = {
    translate: { model: "opencode-go/beam-free", helperExe: "C:\\tools\\opencode.cmd", server: "http://127.0.0.1:4096" }
  };

  service.enrich({ git: { commits: [commit("a", "feat: one")] } }, { config });
  await service.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, "C:\\tools\\opencode.cmd");
  assert.equal(calls[0].server, "http://127.0.0.1:4096");
  assert.equal(calls[0].model, "opencode-go/beam-free");
  const later = { git: { commits: [commit("a", "feat: one")] } };
  service.enrich(later, { config });
  assert.equal(later.git.commits[0].subjectEs, "feat: uno");
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, "utf8")).commits.a, "feat: uno");

  // The project's own kit still wins over the config fallback.
  service.enrich({ git: { commits: [commit("b", "feat: two")] } }, { kit: KIT, config });
  await service.flush();
  assert.equal(calls[1].exe, KIT.helperExe);
});

test("the helper runs in the monitor folder and the prompt never reaches the command line", () => {
  const args = buildHelperArgs({
    server: "http://127.0.0.1:4096",
    model: DEFAULT_MODEL,
    title: "monitor-translate"
  });

  assert.deepEqual(args.slice(0, 2), ["run", "--attach"]);
  assert.equal(args[args.indexOf("--attach") + 1], "http://127.0.0.1:4096");
  assert.equal(args[args.indexOf("--format") + 1], "json");
  assert.equal(args[args.indexOf("-m") + 1], DEFAULT_MODEL);
  assert.equal(args[args.indexOf("--title") + 1], "monitor-translate");

  const dir = args[args.indexOf("--dir") + 1];
  assert.equal(dir, HELPER_DIR);
  assert.equal(path.basename(dir), "monitor");
  assert.equal(fs.existsSync(dir), true, "the helper directory must be a real, stable folder");
  assert.equal(dir.startsWith(os.tmpdir()), false, "the helper must not run in a fresh temp dir");

  assert.equal(args.includes("-f"), false, "the prompt travels over stdin, not as an attachment");
  assert.equal(args.some((arg) => /[\r\n\t]/.test(arg)), false, "no prompt text in the command line");
  assert.equal(args.some((arg) => /traduce|español/i.test(arg)), false, "no prompt text in the command line");

  const bare = buildHelperArgs({ server: "http://127.0.0.1:4096", model: DEFAULT_MODEL });
  assert.equal(bare[bare.indexOf("--title") + 1], "monitor-translate");
});

test("the helper JSON stream is concatenated and non-JSON noise is ignored", () => {
  const stdout = [
    '{"type":"step_start","part":{}}',
    '{"type":"text","part":{"text":"hola"}}',
    "ruido de consola",
    '{"type":"text","part":{"text":" mundo"}}',
    "otra linea rota {"
  ].join("\n");
  assert.equal(collectText(stdout), "hola mundo");
  assert.equal(collectText(""), "");
  assert.equal(collectText(null), "");
});

test("working builders get one short summary, gated by interval and activity signature", async () => {
  const calls = [];
  const runner = async (request) => {
    calls.push(request);
    if (request.title === "monitor-summary") return "Corrigiendo los filtros de mantenimiento y corriendo los tests";
    return "";
  };
  let clock = 0;
  const service = createTranslationService({ cacheFile: tempCache(), runner, now: () => clock });
  const events = Array.from({ length: 22 }, (_, i) => ({
    time: `2026-10-03T12:${String(i).padStart(2, "0")}:00Z`,
    kind: "CMD",
    detail: `paso ${i}`
  }));
  const card = worker("api", events);
  const snapshot = { workers: [card] };

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, "monitor-summary");
  assert.doesNotMatch(calls[0].prompt, /paso 0\b/);
  assert.match(calls[0].prompt, /paso 21/);

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  assert.equal(card.summaryEs, "Corrigiendo los filtros de mantenimiento y corriendo los tests");

  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 1, "the cached signature does not ask again");

  events.push({ time: "2026-10-03T12:30:00Z", kind: "EDIT", detail: "b.ts" });
  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 1, "new activity waits for the interval");

  clock = 130_000;
  service.enrich(snapshot, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 2);

  const done = { name: "web", stateKind: "done", activity: { events: [{ time: "x", kind: "CMD", detail: "y" }] } };
  clock += 130_000;
  service.enrich({ workers: [done] }, { kit: KIT, config: CONFIG });
  await service.flush();
  assert.equal(calls.length, 2, "finished builders never ask for a summary");
  assert.equal(done.summaryEs, undefined);
});
