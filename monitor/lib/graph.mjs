// Pure helpers for the SVG commit graph: they parse
// `git log --all --date-order --format=%H|%P|%D|%s|%ct` output and assign a
// stable lane to every commit so the page can draw lanes, nodes and merge
// edges without any npm dependency. Every lane is also coloured from the
// branch it carries (deterministic per branch name) so the worker cards can
// repeat the same colour next to their model.

const REMOTE_PREFIXES = ["origin/", "upstream/"];

// Lane palette of the git graph. The worker cards reuse these very colours to
// mark the branch of every track.
export const LANE_COLORS = ["#00ff41", "#ffb000", "#55aaff", "#ff66cc", "#9dff4d", "#ff5555", "#5fe8e8", "#c792ea"];
// Dim neutral for a branch that has no lane in the visible tree (same green as
// the page's --dim).
export const NEUTRAL_BRANCH_COLOR = "#00a333";

// Deterministic palette slot per branch name: the same hash feeds the graph
// lanes, the nodes, the worker-card swatch and the CSS variables
// (`--branch-0` … `--branch-7`). An empty or unknown name gets -1, which the
// page renders with the neutral colour.
export function branchColorIndex(name) {
  const text = String(name ?? "").trim();
  if (!text) return -1;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash % LANE_COLORS.length;
}

// Deterministic colour per branch name: the same function feeds the graph
// lanes, the nodes and the worker-card swatch. An empty name gets the neutral
// colour instead of the palette.
export function branchColor(name) {
  const index = branchColorIndex(name);
  return index === -1 ? NEUTRAL_BRANCH_COLOR : LANE_COLORS[index];
}

// Branch name of a single decoration: local branches and the HEAD branch win,
// and remote-only branches drop their `origin/` / `upstream/` prefix so they
// share the colour of the eventual local branch.
function refBranchName(ref) {
  const name = String(ref?.name ?? "");
  if (!name) return "";
  if (ref.kind === "head" || ref.kind === "branch") return name === "HEAD" ? "" : name;
  if (ref.kind === "remote") {
    for (const prefix of REMOTE_PREFIXES) {
      if (name.startsWith(prefix)) return name.slice(prefix.length);
    }
    return name;
  }
  return "";
}

function rowBranchName(commit) {
  const refs = commit?.refs ?? [];
  const local = refs.find((ref) => ref.kind === "head" || ref.kind === "branch");
  if (local) return refBranchName(local);
  const remote = refs.find((ref) => ref.kind === "remote");
  return remote ? refBranchName(remote) : "";
}

// Local branch names the given graph rows can show. The page uses it to tell
// whether a worker branch has a visible lane (otherwise the card swatch goes
// neutral).
export function collectBranches(rows) {
  const names = new Set();
  for (const row of rows ?? []) {
    for (const ref of row?.refs ?? []) {
      const name = refBranchName(ref);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

export function parseRefs(decorations) {
  const text = String(decorations ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      if (piece.startsWith("HEAD -> ")) {
        return { name: piece.slice("HEAD -> ".length).trim(), kind: "head" };
      }
      if (piece === "HEAD") return { name: "HEAD", kind: "head" };
      if (piece.startsWith("tag: ")) return { name: piece.slice(5).trim(), kind: "tag" };
      if (REMOTE_PREFIXES.some((prefix) => piece.startsWith(prefix))) {
        return { name: piece, kind: "remote" };
      }
      return { name: piece, kind: "branch" };
    });
}

export function parseGitLog(stdout) {
  const commits = [];
  for (const rawLine of String(stdout ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const sha = parts[0].trim();
    const parents = parts[1].trim() ? parts[1].trim().split(/\s+/) : [];
    const timestamp = Number(parts[parts.length - 1]);
    if (!sha || !Number.isFinite(timestamp)) continue;
    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      parents,
      refs: parseRefs(parts[2]),
      subject: parts.slice(3, -1).join("|").trim(),
      timestamp,
      time: new Date(timestamp * 1000).toISOString()
    });
  }
  return commits;
}

// Rows keep the parsed commit fields plus:
// - lane: the column of the commit node
// - laneCount: graph width, equal on every row (stable SVG width)
// - parents: [{ sha, lane }] for every parent, including extra merge parents
// - lanesBefore / lanesAfter: the sha each lane waits for around this row, so
//   the renderer can draw pass-through verticals and current merge edges
// - laneColors: one hex colour per lane index for this row, taken from the
//   branch the lane carries (falling back to the fixed lane palette)
// - laneColorIndexes: the matching palette slot per lane (never -1 here: an
//   unnamed lane falls back to its own position in the palette), so the page
//   can paint with the theme's `--branch-<index>` variables.
// `mainShas` (optional Set) holds the first-parent chain of main/master: the
// lanes that wait for one of those commits are flagged in `laneMain` (line
// above the row) and `laneMainAfter` (line below it), whatever name the lane
// carries; without it the lane named main/master (or lane 0) is used.
export function assignLanes(commits, options = {}) {
  const mainShas = options.mainShas instanceof Set && options.mainShas.size ? options.mainShas : null;
  const active = [];
  const activeNames = [];
  const rows = [];
  let width = 0;

  for (const commit of commits) {
    let lane = active.indexOf(commit.sha);
    if (lane === -1) {
      lane = active.indexOf(null);
      if (lane === -1) {
        lane = active.length;
        active.push(null);
      }
      // A reused slot starts a new line until a ref names it.
      activeNames[lane] = null;
    }
    const branch = rowBranchName(commit);
    if (branch) activeNames[lane] = branch;
    // Colours of this row: a lane keeps its name even when the row closes it,
    // so the last vertical and the merge curve stay in the branch colour.
    const namesBefore = activeNames.slice();
    const lanesBefore = active.slice();
    const links = [];

    const firstParent = commit.parents[0] ?? null;
    const existing = firstParent ? active.indexOf(firstParent) : -1;
    if (existing !== -1 && existing !== lane) {
      links.push({ sha: firstParent, lane: existing });
      active[lane] = null;
      activeNames[lane] = null;
    } else {
      active[lane] = firstParent;
      if (firstParent) links.push({ sha: firstParent, lane });
      // A root commit ends its line here.
      else activeNames[lane] = null;
    }

    for (const parent of commit.parents.slice(1)) {
      if (!parent) continue;
      let parentLane = active.indexOf(parent);
      if (parentLane === -1) {
        parentLane = active.indexOf(null);
        if (parentLane === -1) {
          parentLane = active.length;
          active.push(null);
        }
        active[parentLane] = parent;
        // The merged-in line shows its branch colour once its own ref arrives.
        activeNames[parentLane] = null;
      }
      links.push({ sha: parent, lane: parentLane });
    }

    width = Math.max(width, lane + 1);
    for (const link of links) width = Math.max(width, link.lane + 1);

    const lanesAfter = active.slice();
    while (lanesAfter.length && lanesAfter[lanesAfter.length - 1] === null) lanesAfter.pop();
    const laneColors = [];
    const laneColorIndexes = [];
    const laneMain = [];
    const laneMainAfter = [];
    for (let index = 0; index < width; index += 1) {
      const name = namesBefore[index];
      laneMain.push(
        mainShas ? mainShas.has(index === lane ? commit.sha : lanesBefore[index]) : name ? name === "main" || name === "master" : index === 0
      );
      laneColors.push(name ? branchColor(name) : LANE_COLORS[index % LANE_COLORS.length]);
      laneColorIndexes.push(name ? branchColorIndex(name) : index % LANE_COLORS.length);
    }
    for (let index = 0; index < width; index += 1) {
      laneMainAfter.push(mainShas ? mainShas.has(lanesAfter[index]) : laneMain[index]);
    }
    const parentsMain = links.map((link) => (mainShas ? mainShas.has(link.sha) : laneMain[link.lane] === true));
    rows.push({ ...commit, lane, parents: links, lanesBefore, lanesAfter, laneColors, laneColorIndexes, laneMain, laneMainAfter, parentsMain });
  }

  return rows.map((row) => ({ ...row, laneCount: width }));
}
