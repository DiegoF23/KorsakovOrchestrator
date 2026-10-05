import test from "node:test";
import assert from "node:assert/strict";

import {
  activityLineBudget,
  builderTitle,
  firstSentence,
  formatRemaining,
  formatUsageAge,
  modelLabel,
  parseEtaEnd,
  resolveRemainingText,
  shortPath,
  shortText,
  stateFromEvidence,
  stateFromStatus,
  trackIdentity,
  trackShortTitle,
  workerStateKind
} from "../lib/format.mjs";

const MINUTE = 60 * 1000;
const NOW = new Date("2026-10-03T12:00:00");

test("formatRemaining counts down as ~H:MM like monitor-common.ps1", () => {
  assert.equal(formatRemaining(new Date(NOW.getTime() + 90 * MINUTE), NOW), "~1:30");
  assert.equal(formatRemaining(new Date(NOW.getTime() + 45 * MINUTE), NOW), "~0:45");
  assert.equal(formatRemaining(new Date(NOW.getTime() + 59 * 1000), NOW), "~0:00");
  assert.equal(formatRemaining(new Date(NOW.getTime() + 25 * 3600 * 1000), NOW), "~25:00");
});

test("formatRemaining past zero reads excedido with ceil minutes", () => {
  assert.equal(formatRemaining(new Date(NOW.getTime() - 30 * 1000), NOW), "~0:00 (excedido +1 min)");
  assert.equal(formatRemaining(new Date(NOW.getTime() - 61 * 1000), NOW), "~0:00 (excedido +2 min)");
  assert.equal(formatRemaining(new Date(NOW.getTime() - 60 * MINUTE), NOW), "~0:00 (excedido +60 min)");
});

test("formatRemaining ignores missing or invalid etaEnd", () => {
  assert.equal(formatRemaining(null, NOW), "");
  assert.equal(formatRemaining("", NOW), "");
  assert.equal(formatRemaining("not-a-date", NOW), "");
  assert.equal(parseEtaEnd("not-a-date"), null);
  assert.equal(parseEtaEnd(""), null);
  assert.equal(parseEtaEnd("2026-10-02T18:40:00")?.getFullYear(), 2026);
});

test("the finished status file wins over the countdown", () => {
  const etaEnd = new Date(NOW.getTime() + 30 * MINUTE);
  assert.equal(
    resolveRemainingText({ status: { state: "finished", exitCode: 0 }, etaEnd, now: NOW }),
    "terminado"
  );
  assert.equal(
    resolveRemainingText({ status: { state: "finished", exitCode: 1 }, etaEnd, now: NOW }),
    "detenido"
  );
  assert.equal(resolveRemainingText({ status: { state: "running" }, etaEnd, now: NOW }), "~0:30");
  assert.equal(resolveRemainingText({ status: { state: "running" }, etaEnd: null, now: NOW }), "");
});

test("evidence stop lines decide the state when no finished status exists", () => {
  assert.equal(stateFromStatus({ state: "finished", exitCode: 0 }), "terminado");
  assert.equal(stateFromStatus({ state: "finished", exitCode: 2 }), "detenido");
  assert.equal(stateFromStatus({ state: "running" }), null);
  assert.equal(stateFromStatus(null), null);

  const done = "line one\nWEB-MONITOR-STATUS: DONE\n";
  const blocked = "line one\nWEB-MONITOR-STATUS: BLOCKED no live check\n";
  assert.equal(stateFromEvidence(done, "WEB-MONITOR-STATUS"), "terminado");
  assert.equal(stateFromEvidence(blocked, "WEB-MONITOR-STATUS"), "detenido");
  assert.equal(stateFromEvidence("nothing here", "WEB-MONITOR-STATUS"), null);
  assert.equal(stateFromEvidence("x: WEB-MONITOR-STATUS: DONE", "WEB-MONITOR-STATUS"), null);
  assert.equal(
    resolveRemainingText({
      status: null,
      evidenceText: "QA-A-STATUS: DONE\n",
      prefix: "QA-A-STATUS",
      etaEnd: new Date(NOW.getTime() + 10 * MINUTE),
      now: NOW
    }),
    "terminado"
  );
});

test("track identity follows the terminal rules", () => {
  assert.equal(trackIdentity("codex", { label: "Codex R" }), "CODEX");
  assert.equal(trackIdentity("opencode", { letter: "b" }), "OPENCODE B");
  assert.equal(trackIdentity("opencode", { label: "OpenCode A - formularios" }), "OPENCODE A");
  assert.equal(trackIdentity("opencode", { label: "OpenCode - algo" }), "OPENCODE");
  assert.equal(trackIdentity("claude-code", {}), "CLAUDE");
  assert.equal(trackIdentity("antigravity", {}), "ANTIGRAVITY");
});

test("track title falls back to the label for old tracks", () => {
  assert.equal(trackShortTitle({ title: "formularios", label: "OpenCode A" }), "formularios");
  assert.equal(trackShortTitle({ label: "OpenCode A" }), "OpenCode A");
  assert.equal(trackShortTitle({}), "");
});

test("builder title joins identity, title and remaining and omits empties", () => {
  assert.equal(builderTitle("OPENCODE A", "formularios", "~0:45"), "OPENCODE A - formularios - ~0:45");
  assert.equal(builderTitle("CODEX", "cierre", "terminado"), "CODEX - cierre - terminado");
  assert.equal(builderTitle("CODEX", "cierre", ""), "CODEX - cierre");
  assert.equal(builderTitle("CODEX", "", ""), "CODEX");
});

test("shortText and firstSentence mirror the monitors", () => {
  assert.equal(shortText("a   b\n c"), "a b c");
  assert.equal(shortText("abcdef", 4), "abcd...");
  assert.equal(shortText(""), "");
  assert.equal(firstSentence("Listo, termino. Sigo con otra cosa"), "Listo, termino.");
  assert.equal(firstSentence("sin puntuacion"), "sin puntuacion");
});

test("activityLineBudget shrinks the per-card activity as workers grow", () => {
  assert.equal(activityLineBudget(0), 8);
  assert.equal(activityLineBudget(1), 8);
  assert.equal(activityLineBudget(4), 8);
  assert.equal(activityLineBudget(5), 4);
  assert.equal(activityLineBudget(8), 4);
  assert.equal(activityLineBudget(9), 2);
  assert.equal(activityLineBudget(12), 2);
});

test("formatUsageAge reads the age of a usage snapshot in Spanish", () => {
  assert.equal(formatUsageAge(null), "");
  assert.equal(formatUsageAge(0), "actualizado hace menos de 1 min");
  assert.equal(formatUsageAge(0.6), "actualizado hace menos de 1 min");
  assert.equal(formatUsageAge(12), "actualizado hace 12 min");
  assert.equal(formatUsageAge(12.7), "actualizado hace 12 min");
  assert.equal(formatUsageAge(59.9), "actualizado hace 59 min");
  assert.equal(formatUsageAge(60), "actualizado hace 1 h");
  assert.equal(formatUsageAge(75), "actualizado hace 1 h 15 min");
  assert.equal(formatUsageAge(125), "actualizado hace 2 h 05 min");
});

test("workerStateKind maps every state to its card colour family", () => {
  assert.equal(workerStateKind("working"), "working");
  assert.equal(workerStateKind("running"), "working");
  assert.equal(workerStateKind("done"), "done");
  assert.equal(workerStateKind("finished"), "done");
  assert.equal(workerStateKind("error"), "error");
  assert.equal(workerStateKind("blocked"), "error");
  assert.equal(workerStateKind("stopped"), "error");
  assert.equal(workerStateKind("waiting"), "waiting");
  assert.equal(workerStateKind("queued"), "waiting");
  assert.equal(workerStateKind("relaunching"), "waiting");
  assert.equal(workerStateKind("esperando"), "waiting");
  assert.equal(workerStateKind("DONE"), "done");
  assert.equal(workerStateKind("anything-else"), "waiting");
  assert.equal(workerStateKind(""), "waiting");
  assert.equal(workerStateKind(null), "waiting");
  assert.equal(workerStateKind(undefined), "waiting");
});

test("modelLabel joins model and effort level without the word esfuerzo", () => {
  assert.equal(modelLabel("deepseek-v4.1-flash", "max"), "deepseek-v4.1-flash · max");
  assert.equal(modelLabel("gpt-6.1-sol", "medium"), "gpt-6.1-sol · medium");
  assert.equal(modelLabel("gpt-6-sol", ""), "gpt-6-sol");
  assert.equal(modelLabel("gpt-6-sol", null), "gpt-6-sol");
  assert.equal(modelLabel("", "max"), "max");
  assert.equal(modelLabel("", ""), "?");
  assert.equal(modelLabel(null, undefined), "?");
});

test("shortPath strips the repo or worktree prefix", () => {
  const repo = "C:\\Users\\x\\FlotaGrupo";
  const wt = "C:\\Users\\x\\FlotaGrupo-worktrees";
  assert.equal(shortPath("C:\\Users\\x\\FlotaGrupo\\apps\\a.ts", repo, wt), "apps\\a.ts");
  assert.equal(shortPath("C:\\Users\\x\\FlotaGrupo-worktrees\\s4\\apps\\a.ts", repo, wt), "apps\\a.ts");
  assert.equal(shortPath("D:\\other\\a.ts", repo, wt), "D:\\other\\a.ts");
  const long =
    "C:\\Users\\x\\FlotaGrupo-worktrees\\s4\\apps\\web\\src\\features\\incidents\\components\\attachment-viewer-dialog.tsx";
  assert.equal(shortPath(long, repo, wt), "...\\incidents\\components\\attachment-viewer-dialog.tsx");
});
