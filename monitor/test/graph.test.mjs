import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assignLanes,
  branchColor,
  branchColorIndex,
  collectBranches,
  LANE_COLORS,
  NEUTRAL_BRANCH_COLOR,
  parseGitLog,
  parseRefs
} from "../lib/graph.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const read = (name) => fs.readFileSync(path.join(fixtures, name), "utf8");

test("parseGitLog reads sha, parents, refs, subject and commit time", () => {
  const [head] = parseGitLog(read("git-log-linear.txt"));
  assert.equal(head.sha, "L2");
  assert.equal(head.shortSha, "L2");
  assert.deepEqual(head.parents, ["L1"]);
  assert.equal(head.subject, "third commit");
  assert.equal(head.timestamp, 1700002000);
  assert.equal(head.time, new Date(1700002000 * 1000).toISOString());
  assert.deepEqual(head.refs, [
    { name: "main", kind: "head" },
    { name: "origin/main", kind: "remote" }
  ]);
});

test("parseGitLog keeps pipes in the subject and reads tags and empty decorations", () => {
  const commits = parseGitLog(read("git-log-linear.txt"));
  assert.equal(commits[1].subject, "second commit | with pipe");
  assert.deepEqual(commits[1].refs, []);
  assert.deepEqual(commits[2].refs, [{ name: "v1", kind: "tag" }]);
  assert.deepEqual(commits[2].parents, []);
});

test("parseRefs classifies local, remote, tag and detached head decorations", () => {
  assert.deepEqual(parseRefs("HEAD -> main, origin/main, tag: v1, fix/qa"), [
    { name: "main", kind: "head" },
    { name: "origin/main", kind: "remote" },
    { name: "v1", kind: "tag" },
    { name: "fix/qa", kind: "branch" }
  ]);
  assert.deepEqual(parseRefs("HEAD"), [{ name: "HEAD", kind: "head" }]);
  assert.deepEqual(parseRefs(""), []);
  assert.deepEqual(parseRefs(null), []);
});

test("linear history assigns every commit to lane 0", () => {
  const rows = assignLanes(parseGitLog(read("git-log-linear.txt")));
  assert.deepEqual(
    rows.map((row) => row.lane),
    [0, 0, 0]
  );
  assert.equal(rows[0].laneCount, 1);
});

test("a merge opens a second lane for the merged branch and keeps it until the common parent", () => {
  const commits = parseGitLog(read("git-log-merge.txt"));
  const rows = assignLanes(commits);
  assert.deepEqual(
    rows.map((row) => `${row.sha}:${row.lane}`),
    ["M:0", "B:1", "A:0", "R:0"]
  );
  assert.equal(rows[0].laneCount, 2);
  const merge = rows[0];
  assert.deepEqual(merge.parents, [
    { sha: "A", lane: 0 },
    { sha: "B", lane: 1 }
  ]);
  // Both lines run down to the common parent; the merged branch curves in there.
  assert.deepEqual(rows[1].parents, [{ sha: "R", lane: 1 }]);
  assert.deepEqual(rows[2].parents, [{ sha: "R", lane: 0 }]);
  assert.deepEqual(rows[3].joins, [1]);
});

test("two parallel branches keep stable lanes and join at the root", () => {
  const rows = assignLanes(parseGitLog(read("git-log-parallel.txt")));
  assert.deepEqual(
    rows.map((row) => `${row.sha}:${row.lane}`),
    ["X1:0", "M1:1", "X0:0", "M0:1", "R:0"]
  );
  assert.equal(rows[0].laneCount, 2);
  // Each branch keeps its own line to the root and curves into it there.
  assert.deepEqual(rows[3].parents, [{ sha: "R", lane: 1 }]);
  assert.deepEqual(rows[4].joins, [1]);
});

test("branches whose tips share one parent keep one lane each down to the fork", () => {
  const nl = String.fromCharCode(10);
  const rows = assignLanes(
    parseGitLog(
      [
        ["a1", "base", "feat/a", "a", "5"].join("|"),
        ["b1", "base", "feat/b", "b", "4"].join("|"),
        ["c1", "base", "feat/c", "c", "3"].join("|"),
        ["base", "", "main", "base", "2"].join("|")
      ].join(nl)
    )
  );
  assert.deepEqual(rows.map((row) => row.lane), [0, 1, 2, 0]);
  assert.equal(rows[0].laneCount, 3);
  assert.deepEqual(rows[3].joins, [1, 2]);
});

test("assignLanes tolerates empty histories", () => {
  assert.deepEqual(assignLanes([]), []);
  assert.deepEqual(assignLanes(parseGitLog("")), []);
});

test("branchColor is deterministic per name and stays in the graph palette", () => {
  assert.equal(branchColor("main"), branchColor("main"));
  assert.equal(branchColor("feat/monitor-orch"), branchColor("feat/monitor-orch"));
  assert.equal(branchColor("main"), "#ffb000");
  assert.equal(branchColor("feature"), "#5fe8e8");
  for (const name of ["main", "feature", "feat/monitor-orch", "example-web", "x"]) {
    assert.ok(LANE_COLORS.includes(branchColor(name)), `${name} keeps a palette colour`);
  }
  assert.equal(branchColor(""), NEUTRAL_BRANCH_COLOR);
  assert.equal(branchColor(null), NEUTRAL_BRANCH_COLOR);
  assert.equal(branchColor(undefined), NEUTRAL_BRANCH_COLOR);
  assert.ok(!LANE_COLORS.includes(NEUTRAL_BRANCH_COLOR));
});

test("branchColorIndex is the palette slot branchColor maps to, -1 for neutral", () => {
  for (const name of ["main", "feature", "feat/monitor-orch", "example-web", "x"]) {
    const index = branchColorIndex(name);
    assert.equal(LANE_COLORS[index], branchColor(name), `${name} keeps its slot`);
  }
  assert.equal(branchColorIndex(""), -1);
  assert.equal(branchColorIndex("   "), -1);
  assert.equal(branchColorIndex(null), -1);
  assert.equal(branchColorIndex(undefined), -1);
});

test("assignLanes carries the palette index next to every lane colour", () => {
  const rows = assignLanes(parseGitLog(read("git-log-merge.txt")));
  const [merge, feature] = rows;
  assert.equal(merge.laneColorIndexes[0], branchColorIndex("main"));
  // The lane has no ref yet on the merge row, so it falls back to its own
  // position in the palette (the same slot laneColors uses).
  assert.equal(merge.laneColorIndexes[1], 1);
  assert.equal(feature.laneColorIndexes[1], branchColorIndex("feature"));
  for (const row of rows) {
    row.laneColorIndexes.forEach((index, lane) => {
      assert.equal(LANE_COLORS[index], row.laneColors[lane]);
    });
  }
});

test("each graph lane takes the colour of the branch it carries", () => {
  const rows = assignLanes(parseGitLog(read("git-log-merge.txt")));
  const [merge, feature, mainWork, root] = rows;
  assert.equal(merge.laneColors[0], branchColor("main"));
  assert.equal(merge.laneColors[1], LANE_COLORS[1]);
  assert.equal(feature.laneColors[1], branchColor("feature"));
  assert.equal(mainWork.laneColors[0], branchColor("main"));
  assert.equal(root.laneColors[1], branchColor("feature"));
});

test("a lane keeps its branch colour through the row that closes it", () => {
  const rows = assignLanes(parseGitLog(read("git-log-parallel.txt")));
  const mergeRow = rows[3];
  assert.equal(mergeRow.laneColors[0], branchColor("feature/x"));
  assert.equal(mergeRow.laneColors[1], branchColor("main"));
});

test("collectBranches lists the local branches a graph shows, without remote prefixes", () => {
  assert.deepEqual(collectBranches(assignLanes(parseGitLog(read("git-log-merge.txt")))), ["feature", "main"]);
  assert.deepEqual(collectBranches(assignLanes(parseGitLog(read("git-log-linear.txt")))), ["main"]);
  assert.deepEqual(collectBranches(assignLanes(parseGitLog(read("git-log-parallel.txt")))), ["feature/x", "main"]);
  assert.deepEqual(collectBranches([]), []);
});

test("lanes carrying main or master are flagged for the page", () => {
  const rows = assignLanes(parseGitLog([
    ["a1", "b2", "HEAD -> main", "tip", "3"].join("|"),
    ["b2", "", "", "root", "2"].join("|")
  ].join(String.fromCharCode(10))));
  assert.equal(rows[0].laneMain[0], true);
});

test("with a main chain, the lane waiting for a main commit is flagged whatever its name", () => {
  const nl = String.fromCharCode(10);
  const rows = assignLanes(
    parseGitLog(
      [
        ["m2", "m1 f1", "HEAD -> main", "merge", "4"].join("|"),
        ["f1", "m1", "feature", "work", "3"].join("|"),
        ["m1", "", "", "base", "2"].join("|")
      ].join(nl)
    ),
    { mainShas: new Set(["m2", "m1"]) }
  );
  assert.equal(rows[0].laneMain[rows[0].lane], true);
  const feature = rows[1];
  assert.equal(feature.laneMain[feature.lane], false);
  const order = rows[0].parents.map((link) => link.sha);
  assert.equal(rows[0].parentsMain[order.indexOf("f1")], false);
  assert.equal(rows[0].parentsMain[order.indexOf("m1")], true);
});
