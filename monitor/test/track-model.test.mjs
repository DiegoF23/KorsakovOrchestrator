import test from "node:test";
import assert from "node:assert/strict";

import { trackIdentity } from "../lib/format.mjs";
import { modelText } from "../lib/state.mjs";

const kit = { model: { opencode: "opencode-go/deepseek-v4.1-flash", variant: "max", codex: "gpt-6.1-sol", codexEffort: "medium" } };

test("an OpenCode track shows the kit model when it pins none", () => {
  assert.equal(modelText("opencode", kit, {}, { name: "a" }), "deepseek-v4.1-flash · max");
});

test("an OpenCode track shows its own pinned model without the kit variant", () => {
  assert.equal(modelText("opencode", kit, {}, { model: "opencode-go/longcat-2.5-preview-free" }), "longcat-2.5-preview-free");
  assert.equal(modelText("opencode", kit, {}, { model: "opencode-go/space-bunny-free", variant: "high" }), "space-bunny-free · high");
});

test("codex tracks keep the kit codex model", () => {
  assert.equal(modelText("codex", kit, {}, { model: "ignored" }), "gpt-6.1-sol · medium");
});

test("a Claude track shows its model and effort, por defecto when absent", () => {
  const config = { orchestrator: { model: "claude-opus-5-5", effort: "high" } };
  assert.equal(modelText("claude-code", kit, config, { model: "claude-sonnet-4-5", effort: "high" }), "claude-sonnet-4-5 · high");
  assert.equal(modelText("claude-code", kit, config, { model: "claude-sonnet-4-5" }), "claude-sonnet-4-5 · por defecto");
  assert.equal(modelText("claude-code", kit, config, { model: "claude-sonnet-4-5", effort: "  " }), "claude-sonnet-4-5 · por defecto");
  assert.equal(modelText("claude-code", kit, config, {}), "claude-opus-5-5 · por defecto");
  assert.equal(modelText("claude-code", kit, {}, {}), "Claude Code · por defecto");
});

test("OpenCode letters go beyond D", () => {
  assert.equal(trackIdentity("opencode", { letter: "E" }), "OPENCODE E");
  assert.equal(trackIdentity("opencode", { label: "OpenCode H (LongCat) - x" }), "OPENCODE H");
  assert.equal(trackIdentity("opencode", { letter: "Z" }), "OPENCODE");
});
