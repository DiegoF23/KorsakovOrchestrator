import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { agyBrainDir, agyConversationTitle, buildWorkers, buildWorkerSteps, recentAgyConversations, withOrchestratorTracks } from "../lib/state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

const REPO = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo";
const WT = "C:\\Users\\DiegoFA\\Desktop\\FlotaGrupo-worktrees";
const NOW = new Date("2026-10-06T12:00:00Z");

const transcript = (entries) => `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

const userInput = (content) => ({
  step_index: 0,
  source: "USER_EXPLICIT",
  type: "USER_INPUT",
  status: "DONE",
  created_at: "2026-10-06T11:59:00Z",
  content
});

function newBrainHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agy-brain-home-"));
  return { home, brainDir: agyBrainDir(home) };
}

function writeConversation(brainDir, id, content, minutesAgo) {
  const dir = path.join(brainDir, id, ".system_generated", "logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, content);
  const at = new Date(NOW.getTime() - minutesAgo * 60000);
  fs.utimesSync(file, at, at);
  return file;
}

test("agy discovery reads the default brain folder from the home it is given", () => {
  const home = path.join(os.tmpdir(), "agy-home");
  assert.equal(agyBrainDir(home), path.join(home, ".gemini", "antigravity-cli", "brain"));
  assert.deepEqual(recentAgyConversations(path.join(home, "nope"), { repo: REPO }, NOW), []);
  assert.deepEqual(recentAgyConversations(null, { repo: REPO }, NOW), []);
});

test("agy discovery keeps the project's recent conversations, newest first", () => {
  const { brainDir } = newBrainHome();
  writeConversation(
    brainDir,
    "aaaa1111-0000",
    transcript([
      userInput("<USER_REQUEST>\n/plan Fix the widget\n</USER_REQUEST>"),
      { step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", content: `File Path: \`file:///${REPO.replace(/\\/g, "/")}/apps/web/x.ts\`` }
    ]),
    1
  );
  writeConversation(
    brainDir,
    "bbbb2222-0000",
    transcript([userInput("Only the worktrees parent shows up here"), { step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", content: `Path: ${WT}\\mail-alerts\\x.ts` }]),
    5
  );
  writeConversation(
    brainDir,
    "cccc3333-0000",
    transcript([userInput("Another project"), { step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", content: "C:\\Users\\DiegoFA\\Desktop\\OtraApp\\x.ts" }]),
    2
  );
  writeConversation(brainDir, "dddd4444-0000", transcript([userInput(`Old run in ${REPO}`)]), 61);

  const found = recentAgyConversations(brainDir, { repo: REPO, worktreeParent: WT }, NOW);
  assert.deepEqual(found.map((item) => item.id), ["aaaa1111-0000", "bbbb2222-0000"]);
  assert.equal(found[0].title, "Fix the widget");
  assert.equal(found[0].file, path.join(brainDir, "aaaa1111-0000", ".system_generated", "logs", "transcript.jsonl"));
  assert.ok(Math.abs(found[0].mtimeMs - (NOW.getTime() - 60000)) < 1000);

  const byWorktree = recentAgyConversations(brainDir, { repo: "C:\\Otro\\Repo", worktreeParent: WT }, NOW);
  assert.deepEqual(byWorktree.map((item) => item.id), ["bbbb2222-0000"], "the worktree parent alone is enough");
});

test("a project mention beyond the 64 KB head does not count", () => {
  const { brainDir } = newBrainHome();
  writeConversation(
    brainDir,
    "far11111-0000",
    transcript([
      userInput("p".repeat(70000)),
      { step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", content: `Workspace: ${REPO}` }
    ]),
    1
  );
  writeConversation(brainDir, "near1111-0000", transcript([userInput(`Early ${REPO}`)]), 2);

  const found = recentAgyConversations(brainDir, { repo: REPO }, NOW);
  assert.deepEqual(found.map((item) => item.id), ["near1111-0000"]);
});

test("the conversation title drops the tags, the /plan and the excess", () => {
  assert.equal(
    agyConversationTitle(
      transcript([
        userInput("<USER_REQUEST>\n/plan Fix the widget and add tests\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nnoise\n</ADDITIONAL_METADATA>")
      ])
    ),
    "Fix the widget and add tests"
  );
  assert.equal(agyConversationTitle(transcript([userInput("<USER_REQUEST>Read the brief</USER_REQUEST>")])), "Read the brief");
  const long = agyConversationTitle(transcript([userInput(`<USER_REQUEST>\n/plan ${"x".repeat(120)}\n</USER_REQUEST>`)]));
  assert.equal(long.length, 80);
  assert.equal(long, "x".repeat(80));
  assert.equal(agyConversationTitle(transcript([{ step_index: 0, type: "GENERIC", content: "no user here" }])), "");
  assert.equal(agyConversationTitle("%%% not json"), "");
});

test("agy discovery caps the list at six conversations", () => {
  const { brainDir } = newBrainHome();
  for (let index = 1; index <= 7; index += 1) {
    writeConversation(brainDir, `conv-${index}`, transcript([userInput(`Run ${index} in ${REPO}`)]), index);
  }
  const found = recentAgyConversations(brainDir, { repo: REPO }, NOW);
  assert.equal(found.length, 6);
  assert.deepEqual(found.map((item) => item.id), ["conv-1", "conv-2", "conv-3", "conv-4", "conv-5", "conv-6"]);
});

test("discovered conversations become synthetic Antigravity cards", () => {
  const { home, brainDir } = newBrainHome();
  writeConversation(
    brainDir,
    "aaaa1111-2222-3333",
    transcript([
      userInput("<USER_REQUEST>\n/plan Fix the widget\n</USER_REQUEST>"),
      { step_index: 1, source: "MODEL", type: "GENERIC", status: "DONE", content: `Workspace: ${REPO}` }
    ]),
    1
  );
  writeConversation(brainDir, "bbbb2222-3333-4444", transcript([userInput(`Older run in ${REPO}`)]), 10);

  const kit = { tracks: [{ name: "builder-a", engine: "opencode" }] };
  const out = withOrchestratorTracks(kit, { repo: REPO }, {}, NOW, { brainDir, home, worktreeParent: WT });

  assert.deepEqual(out.tracks.map((track) => track.name), ["agy-aaaa1111", "agy-bbbb2222", "builder-a"]);
  const fresh = out.tracks[0];
  assert.equal(fresh.engine, "antigravity");
  assert.equal(fresh.title, "Fix the widget");
  assert.equal(fresh.label, "Gemini · Antigravity");
  assert.equal(fresh.workdir, REPO);
  assert.equal(fresh.activityFile, path.join(brainDir, "aaaa1111-2222-3333", ".system_generated", "logs", "transcript.jsonl"));
  assert.equal(fresh.activityFormat, "brain");
  assert.equal(fresh.__state, "working");
  assert.equal(fresh.__statusTime, new Date(NOW.getTime() - 60000).toISOString());
  assert.equal(fresh.model, undefined, "no model is guessed for a discovered run");
  assert.equal(out.tracks[1].__state, "done");
  assert.equal(kit.tracks.length, 1, "the kit itself is never modified");
});

test("a conversation of the kit's worktree parent is discovered through the kit", () => {
  const { home, brainDir } = newBrainHome();
  writeConversation(brainDir, "cccc3333-4444-5555", transcript([userInput(`Worktree run in ${WT}\\feature`)]), 1);
  const kit = { worktreeParent: WT, tracks: [] };
  const project = { repo: "C:\\Otro\\Repo", kitConfig: path.join(home, "kit.config.json") };

  const out = withOrchestratorTracks(kit, project, {}, NOW, { brainDir, home });
  assert.deepEqual(out.tracks.map((track) => track.name), ["agy-cccc3333"]);
  assert.equal(out.tracks[0].label, "Gemini · Antigravity");
});

test("config.agyConversations === false turns the discovery off", () => {
  const { home, brainDir } = newBrainHome();
  writeConversation(brainDir, "aaaa1111-2222-3333", transcript([userInput(`Run in ${REPO}`)]), 1);
  const kit = { tracks: [] };

  assert.equal(withOrchestratorTracks(kit, { repo: REPO }, { agyConversations: false }, NOW, { brainDir, home }), kit);
  const on = withOrchestratorTracks(kit, { repo: REPO }, {}, NOW, { brainDir, home });
  assert.deepEqual(on.tracks.map((track) => track.name), ["agy-aaaa1111"]);
});

test("a brain track feeds the card and the live view through the state builders", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-brain-build-"));
  const transcriptFile = path.join(dir, "transcript.jsonl");
  fs.copyFileSync(path.join(fixtures, "agy-brain-transcript.jsonl"), transcriptFile);
  const track = { name: "agy-brain-a", engine: "antigravity", activityFile: transcriptFile, activityFormat: "brain", board: true };
  const kitConfig = path.join(dir, "kit.config.json");
  fs.writeFileSync(kitConfig, JSON.stringify({ tracks: [track] }));
  const config = { __baseDir: dir, workers: { kitConfig }, orchestrator: {} };
  const project = { id: "p", name: "P", repo: null, kitConfig };

  const workers = await buildWorkers({
    kit: { tracks: [track] },
    kitDir: dir,
    config,
    repo: null,
    worktreeParent: null,
    now: NOW
  });
  assert.equal(workers.length, 1);
  assert.equal(workers[0].engine, "antigravity");
  assert.equal(workers[0].model, "Antigravity", "the card never guesses the model");
  assert.ok(workers[0].activity.events.length > 0, "the brain transcript feeds the card");
  assert.equal(workers[0].activity.events.at(-1).kind, "DONE");

  const result = await buildWorkerSteps(config, { project, worker: "agy-brain-a", now: NOW });
  assert.equal(result.engine, "antigravity");
  assert.ok(result.steps.some((step) => step.type === "memory"));
});
