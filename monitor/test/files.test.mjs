import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createRequestHandler, routeRequest } from "../server.mjs";
import {
  explorerArguments,
  FILE_TYPES,
  isInside,
  kindOf,
  parseRange,
  resolveContained,
  spawnExplorer,
  TREE_LIMIT
} from "../lib/files.mjs";

const WINDOWS = process.platform === "win32";

// ---- Fixture: a fake worker folder with real files ---------------------------
// base/work        the worker's workdir
// base/workx       a sibling whose name starts with the workdir's name
// base/outside     a folder the worker must never reach
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "monitor-files-")));
const work = path.join(base, "work");
const sibling = path.join(base, "workx");
const outside = path.join(base, "outside");
for (const dir of [work, path.join(work, "sub"), path.join(work, "node_modules", "pkg"), path.join(work, ".hidden"), sibling, outside]) {
  fs.mkdirSync(dir, { recursive: true });
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 7)]);
const MP4 = Buffer.alloc(200);
for (let index = 0; index < MP4.length; index += 1) MP4[index] = index;
fs.writeFileSync(path.join(work, "shot.png"), PNG);
fs.writeFileSync(path.join(work, "clip.mp4"), MP4);
fs.writeFileSync(path.join(work, "notes.txt"), "plain notes");
fs.writeFileSync(path.join(work, "empty.png"), "");
fs.writeFileSync(path.join(work, "vector.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
fs.writeFileSync(path.join(work, "sub", "inner.png"), PNG);
fs.writeFileSync(path.join(work, "node_modules", "pkg", "index.js"), "x");
fs.writeFileSync(path.join(work, ".hidden", "secret.txt"), "x");
fs.writeFileSync(path.join(sibling, "leak.png"), PNG);
fs.writeFileSync(path.join(outside, "secret.png"), PNG);
fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");

// Links that point outside (or at a script) where the OS lets us create them.
function tryLink(target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false;
  }
}
const hasJunction = tryLink(outside, path.join(work, "escape"), WINDOWS ? "junction" : "dir");
const hasFileLink = tryLink(path.join(outside, "secret.png"), path.join(work, "stolen.png"), "file");
const hasInnerLink = tryLink(path.join(work, "notes.txt"), path.join(work, "disguised.png"), "file");

const kitFile = path.join(base, "kit.json");
fs.writeFileSync(kitFile, JSON.stringify({ tracks: [{ name: "t1", workdir: work }, { name: "ghost", workdir: path.join(base, "missing") }, { name: "bare" }] }));
const configFile = path.join(base, "fleet-monitor.config.json");
fs.writeFileSync(configFile, JSON.stringify({ projects: [{ id: "one", name: "One", repo: ".", kitConfig: "./kit.json" }] }));

function removeLink(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    try {
      fs.rmdirSync(link);
    } catch {
      // Already gone.
    }
  }
}

after(() => {
  for (const link of ["escape", "stolen.png", "disguised.png"]) removeLink(path.join(work, link));
  fs.rmSync(base, { recursive: true, force: true });
});

// ---- Real HTTP server so streaming, Range and bodies behave like production --
const servers = [];

async function startServer(extra = {}) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  server.on("request", createRequestHandler({ __file: configFile }, { serverDir: base, configPath: configFile, port, ...extra }));
  servers.push(server);
  const origin = `http://127.0.0.1:${port}`;

  function call(method, target, { headers = {}, body, chunked = false } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, method, path: target, headers, agent: false }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      request.on("error", reject);
      if (body !== undefined) {
        if (chunked) {
          for (const part of body) request.write(part);
        } else {
          request.setHeader("Content-Length", Buffer.byteLength(body));
          request.write(body);
        }
      }
      request.end();
    });
  }

  const json = (response) => JSON.parse(response.body.toString("utf8"));
  const postOpen = (payload, headers = {}) =>
    call("POST", "/api/open-in-explorer", {
      headers: { "Content-Type": "application/json", Origin: origin, ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload)
    });
  return { port, origin, call, json, postOpen };
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const launches = [];
const shared = await startServer({
  openInExplorer: (args, info) => {
    launches.push({ args, ...info });
  },
  execFile: async () => {
    throw new Error("not a git repository");
  }
});

const fileUrl = (relative, extra = "") => `/api/file?project=one&worker=t1&path=${encodeURIComponent(relative)}${extra}`;
const infoUrl = (relative) => `/api/file-info?project=one&worker=t1&path=${encodeURIComponent(relative)}`;

// ---- Routing -----------------------------------------------------------------

test("the router knows the file routes and keeps the open action POST-only", () => {
  assert.equal(routeRequest("GET", "/api/file"), "file");
  assert.equal(routeRequest("HEAD", "/api/file"), "file");
  assert.equal(routeRequest("GET", "/api/file-info"), "file-info");
  assert.equal(routeRequest("GET", "/api/tree"), "tree");
  assert.equal(routeRequest("POST", "/api/open-in-explorer"), "open");
  assert.equal(routeRequest("GET", "/api/open-in-explorer"), null);
  assert.equal(routeRequest("HEAD", "/api/open-in-explorer"), null);
  assert.equal(routeRequest("POST", "/api/file"), null);
  assert.equal(routeRequest("POST", "/api/tree"), null);
  assert.equal(routeRequest("PUT", "/api/open-in-explorer"), null);
});

// ---- /api/file ---------------------------------------------------------------

test("/api/file serves an allowed file with its fixed type and the security headers", async () => {
  const response = await shared.call("GET", fileUrl("shot.png"));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, PNG);
  assert.equal(response.headers["content-type"], "image/png");
  assert.equal(response.headers["content-length"], String(PNG.length));
  assert.equal(response.headers["accept-ranges"], "bytes");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["content-disposition"], "inline");
  assert.equal(
    response.headers["content-security-policy"],
    "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:"
  );

  const video = await shared.call("GET", fileUrl("clip.mp4"));
  assert.equal(video.status, 200);
  assert.equal(video.headers["content-type"], "video/mp4");
  assert.deepEqual(video.body, MP4);

  const svg = await shared.call("GET", fileUrl("vector.svg"));
  assert.equal(svg.headers["content-type"], "image/svg+xml");
  assert.match(svg.headers["content-security-policy"], /^sandbox;/);
});

test("/api/file answers HEAD with the headers and no body, and an empty file with 200", async () => {
  const head = await shared.call("HEAD", fileUrl("shot.png"));
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-length"], String(PNG.length));
  assert.equal(head.body.length, 0);

  const empty = await shared.call("GET", fileUrl("empty.png"));
  assert.equal(empty.status, 200);
  assert.equal(empty.body.length, 0);
  assert.equal((await shared.call("GET", fileUrl("empty.png"), { headers: { Range: "bytes=0-0" } })).status, 416);
});

test("/api/file resolves a relative path in a subfolder and an absolute path inside the workdir", async () => {
  const relative = await shared.call("GET", fileUrl("sub/inner.png"));
  assert.equal(relative.status, 200);
  assert.deepEqual(relative.body, PNG);

  const windowsStyle = await shared.call("GET", fileUrl("sub\\..\\shot.png"));
  assert.equal(windowsStyle.status, WINDOWS ? 200 : 404);

  const absolute = await shared.call("GET", fileUrl(path.join(work, "shot.png")));
  assert.equal(absolute.status, 200);
  assert.deepEqual(absolute.body, PNG);
});

test("/api/file refuses `..` traversal, even for a file that does not exist", async () => {
  for (const attempt of ["../outside/secret.png", "../workx/leak.png", "sub/../../outside/secret.png", "..\\outside\\secret.png"]) {
    const response = await shared.call("GET", fileUrl(attempt));
    assert.equal(response.status, 403, attempt);
    assert.equal(response.body.includes(PNG), false, attempt);
  }
  // Same answer whether or not the target exists: the status never maps what is outside.
  assert.equal((await shared.call("GET", fileUrl("../outside/nothing-here.png"))).status, 403);
  assert.equal((await shared.call("GET", fileUrl("../nothing-here/at-all.png"))).status, 403);
});

test("/api/file refuses an absolute path outside the workdir", async () => {
  const response = await shared.call("GET", fileUrl(path.join(outside, "secret.png")));
  assert.equal(response.status, 403);
  assert.equal((await shared.call("GET", fileUrl(path.join(outside, "gone.png")))).status, 403);
  assert.equal((await shared.call("GET", fileUrl(path.join(os.tmpdir(), "..", "..", "Windows", "win.ini")))).status, 403);
});

test("/api/file refuses a sibling folder whose name starts with the workdir's", async () => {
  const response = await shared.call("GET", fileUrl(path.join(`${work}x`, "leak.png")));
  assert.equal(response.status, 403);
  assert.equal(isInside(work, `${work}x`), false);
  assert.equal(isInside(work, path.join(`${work}x`, "leak.png")), false);
});

test("/api/file refuses UNC and device paths without touching the network", async () => {
  for (const attempt of ["\\\\evil.example\\share\\a.png", "//evil.example/share/a.png", "\\\\?\\C:\\Windows\\win.ini", "\\\\.\\pipe\\x"]) {
    assert.equal((await shared.call("GET", fileUrl(attempt))).status, 403, attempt);
  }
});

test("/api/file refuses NUL bytes, stream names and drive-relative paths", async () => {
  assert.equal((await shared.call("GET", fileUrl("shot.png\u0000.txt"))).status, 400);
  assert.equal((await shared.call("GET", `/api/file?project=one&worker=t1`)).status, 400);
  assert.equal((await shared.call("GET", fileUrl(""))).status, 400);
  assert.equal((await shared.call("GET", fileUrl("a".repeat(5000)))).status, 400);
  if (WINDOWS) {
    assert.equal((await shared.call("GET", fileUrl("notes.txt:hidden"))).status, 400);
    assert.equal((await shared.call("GET", fileUrl("shot.png::$DATA"))).status, 400);
    assert.equal((await shared.call("GET", fileUrl("C:shot.png"))).status, 400);
  }
});

test("/api/file refuses a junction or symlink that leaves the workdir", { skip: !hasJunction && !hasFileLink && "cannot create links here" }, async () => {
  if (hasJunction) {
    const response = await shared.call("GET", fileUrl("escape/secret.png"));
    assert.equal(response.status, 403);
    assert.equal((await shared.call("GET", fileUrl("escape/missing.png"))).status, 403);
    assert.equal((await shared.call("GET", fileUrl(path.join(work, "escape", "secret.png")))).status, 403);
  }
  if (hasFileLink) {
    assert.equal((await shared.call("GET", fileUrl("stolen.png"))).status, 403);
  }
});

test("/api/file judges a link by its real target, so a disguised file is refused", { skip: !hasInnerLink && "cannot create file links here" }, async () => {
  const response = await shared.call("GET", fileUrl("disguised.png"));
  assert.equal(response.status, 415);
});

test("/api/file answers 404 for an unknown project, worker or file", async () => {
  assert.equal((await shared.call("GET", "/api/file?project=nope&worker=t1&path=shot.png")).status, 404);
  assert.equal((await shared.call("GET", "/api/file?project=one&worker=nope&path=shot.png")).status, 404);
  assert.equal((await shared.call("GET", "/api/file?project=one&path=shot.png")).status, 404);
  assert.equal((await shared.call("GET", "/api/file?project=one&worker=bare&path=shot.png")).status, 404);
  assert.equal((await shared.call("GET", "/api/file?project=one&worker=ghost&path=shot.png")).status, 404);
  assert.equal((await shared.call("GET", fileUrl("missing.png"))).status, 404);
  assert.equal((await shared.call("GET", fileUrl("sub/missing/deeper.png"))).status, 404);
  // Without a project the first one wins, like every other route.
  assert.equal((await shared.call("GET", "/api/file?worker=t1&path=shot.png")).status, 200);
});

test("/api/file refuses an extension outside the allowlist with 415", async () => {
  const response = await shared.call("GET", fileUrl("notes.txt"));
  assert.equal(response.status, 415);
  assert.equal(response.body.includes("plain notes"), false);
  assert.equal((await shared.call("GET", fileUrl("../outside/secret.txt"))).status, 403);
});

test("/api/file answers 400 for a directory", async () => {
  assert.equal((await shared.call("GET", fileUrl("sub"))).status, 400);
  assert.equal((await shared.call("GET", fileUrl("."))).status, 400);
  assert.equal((await shared.call("GET", fileUrl(work))).status, 400);
});

test("/api/file serves one byte range with 206 and Content-Range", async () => {
  const slice = await shared.call("GET", fileUrl("clip.mp4"), { headers: { Range: "bytes=10-19" } });
  assert.equal(slice.status, 206);
  assert.equal(slice.headers["content-range"], "bytes 10-19/200");
  assert.equal(slice.headers["content-length"], "10");
  assert.equal(slice.headers["accept-ranges"], "bytes");
  assert.equal(slice.headers["content-type"], "video/mp4");
  assert.equal(slice.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(slice.body, MP4.subarray(10, 20));

  const open = await shared.call("GET", fileUrl("clip.mp4"), { headers: { Range: "bytes=190-" } });
  assert.equal(open.status, 206);
  assert.equal(open.headers["content-range"], "bytes 190-199/200");
  assert.deepEqual(open.body, MP4.subarray(190));

  const suffix = await shared.call("GET", fileUrl("clip.mp4"), { headers: { Range: "bytes=-5" } });
  assert.equal(suffix.headers["content-range"], "bytes 195-199/200");
  assert.deepEqual(suffix.body, MP4.subarray(195));

  const clamped = await shared.call("GET", fileUrl("clip.mp4"), { headers: { Range: "bytes=0-9999" } });
  assert.equal(clamped.headers["content-range"], "bytes 0-199/200");
  assert.deepEqual(clamped.body, MP4);
});

test("/api/file answers 416 with the size for an invalid or unsatisfiable range", async () => {
  for (const range of ["bytes=500-600", "bytes=200-", "bytes=5-2", "bytes=abc", "bytes=-", "bytes=-0", "items=0-5", "bytes=0-1,5-6"]) {
    const response = await shared.call("GET", fileUrl("clip.mp4"), { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers["content-range"], "bytes */200", range);
  }
});

test("/api/file answers 413 above the size limit", async () => {
  const small = await startServer({ maxFileBytes: 100, execFile: async () => { throw new Error("no git"); } });
  assert.equal((await small.call("GET", fileUrl("shot.png"))).status, 200);
  assert.equal((await small.call("GET", fileUrl("clip.mp4"))).status, 413);
});

// ---- /api/file-info ----------------------------------------------------------

test("/api/file-info reports metadata for any extension and never the content", async () => {
  const text = await shared.call("GET", infoUrl("notes.txt"));
  assert.equal(text.status, 200);
  assert.match(text.headers["content-type"], /application\/json/);
  const info = shared.json(text);
  assert.deepEqual(Object.keys(info).sort(), ["kind", "modified", "name", "path", "size"]);
  assert.equal(info.name, "notes.txt");
  assert.equal(info.path, path.join(work, "notes.txt"));
  assert.equal(info.size, "plain notes".length);
  assert.equal(info.kind, "other");
  assert.equal(new Date(info.modified).toISOString(), info.modified);
  assert.equal(text.body.includes("plain notes"), false);

  assert.equal(shared.json(await shared.call("GET", infoUrl("shot.png"))).kind, "image");
  assert.equal(shared.json(await shared.call("GET", infoUrl("clip.mp4"))).kind, "video");
});

test("/api/file-info applies the same containment and error codes", async () => {
  assert.equal((await shared.call("GET", infoUrl("../outside/secret.txt"))).status, 403);
  assert.equal((await shared.call("GET", infoUrl(path.join(outside, "secret.txt")))).status, 403);
  assert.equal((await shared.call("GET", infoUrl(path.join(`${work}x`, "leak.png")))).status, 403);
  assert.equal((await shared.call("GET", infoUrl("sub"))).status, 400);
  assert.equal((await shared.call("GET", infoUrl("missing.txt"))).status, 404);
  assert.equal((await shared.call("GET", "/api/file-info?project=nope&worker=t1&path=notes.txt")).status, 404);
  assert.equal((await shared.call("GET", "/api/file-info?project=one&worker=nope&path=notes.txt")).status, 404);
  if (hasJunction) assert.equal((await shared.call("GET", infoUrl("escape/secret.txt"))).status, 403);
});

// ---- /api/tree ---------------------------------------------------------------

test("/api/tree walks a non-git folder, skipping node_modules, dot-folders and links", async () => {
  const response = await shared.call("GET", "/api/tree?project=one&worker=t1");
  assert.equal(response.status, 200);
  const tree = shared.json(response);
  assert.equal(tree.root, work);
  assert.equal(tree.truncated, false);
  assert.ok(tree.files.includes("shot.png"));
  assert.ok(tree.files.includes("sub/inner.png"));
  assert.ok(tree.files.every((file) => !file.includes("\\")));
  assert.ok(tree.files.every((file) => !file.startsWith("node_modules/") && !file.startsWith(".hidden/")));
  assert.ok(tree.files.every((file) => !file.startsWith("escape/")), "a junction is never followed");
});

test("/api/tree caps the listing and says so", async () => {
  assert.equal(TREE_LIMIT, 5000);
  const capped = await startServer({ treeLimit: 3, execFile: async () => { throw new Error("no git"); } });
  const tree = capped.json(await capped.call("GET", "/api/tree?project=one&worker=t1"));
  assert.equal(tree.files.length, 3);
  assert.equal(tree.truncated, true);
});

test("/api/tree caches per project and worker for 10 seconds", async () => {
  let clock = new Date("2026-10-05T12:00:00Z").getTime();
  const cached = await startServer({ now: () => new Date(clock), execFile: async () => { throw new Error("no git"); } });
  const first = cached.json(await cached.call("GET", "/api/tree?project=one&worker=t1"));
  fs.writeFileSync(path.join(work, "late.txt"), "late");
  try {
    clock += 9000;
    const hit = cached.json(await cached.call("GET", "/api/tree?project=one&worker=t1"));
    assert.deepEqual(hit.files, first.files);
    assert.ok(!hit.files.includes("late.txt"));
    clock += 2000;
    const fresh = cached.json(await cached.call("GET", "/api/tree?project=one&worker=t1"));
    assert.ok(fresh.files.includes("late.txt"));
  } finally {
    fs.rmSync(path.join(work, "late.txt"), { force: true });
  }
});

test("/api/tree asks git with an argument array and uses its list", async () => {
  const calls = [];
  const git = await startServer({
    execFile: async (file, args, execOptions) => {
      calls.push({ file, args, execOptions });
      return { stdout: "shot.png\0sub/inner.png\0deleted.png\0../escape.png\0notes.txt\0sub\0" };
    }
  });
  const tree = git.json(await git.call("GET", "/api/tree?project=one&worker=t1"));
  assert.deepEqual(tree.files, ["shot.png", "sub/inner.png", "notes.txt"]);
  assert.equal(tree.truncated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "git");
  assert.ok(Array.isArray(calls[0].args));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf("-C"), calls[0].args.indexOf("-C") + 2), ["-C", work]);
  for (const flag of ["ls-files", "--cached", "--others", "--exclude-standard"]) assert.ok(calls[0].args.includes(flag), flag);
  assert.ok(calls[0].args.includes("core.fsmonitor=false"));
  assert.equal(calls[0].execOptions.timeout, 5000);
  assert.notEqual(calls[0].execOptions.shell, true);
});

test("/api/tree honors .gitignore in a real repository", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git is not installed");
    return;
  }
  const repo = fs.mkdtempSync(path.join(base, "repo-"));
  execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.log\n");
  fs.writeFileSync(path.join(repo, "kept.txt"), "k");
  fs.writeFileSync(path.join(repo, "ignored.log"), "i");
  fs.mkdirSync(path.join(repo, "dir"));
  fs.writeFileSync(path.join(repo, "dir", "unicode-é.txt"), "u");
  const repoKit = path.join(base, "kit-repo.json");
  fs.writeFileSync(repoKit, JSON.stringify({ tracks: [{ name: "repo", workdir: repo }] }));
  const repoConfig = path.join(base, "repo-config.json");
  fs.writeFileSync(repoConfig, JSON.stringify({ projects: [{ id: "git", repo: ".", kitConfig: "./kit-repo.json" }] }));

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address();
  server.on("request", createRequestHandler({ __file: repoConfig }, { serverDir: base, configPath: repoConfig, port }));
  const body = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/api/tree?project=git&worker=repo", agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  assert.deepEqual([...body.files].sort(), [".gitignore", "dir/unicode-é.txt", "kept.txt"]);
});

test("/api/tree answers 404 for an unknown project or worker", async () => {
  assert.equal((await shared.call("GET", "/api/tree?project=nope&worker=t1")).status, 404);
  assert.equal((await shared.call("GET", "/api/tree?project=one&worker=nope")).status, 404);
  assert.equal((await shared.call("GET", "/api/tree?project=one&worker=ghost")).status, 404);
});

// ---- /api/open-in-explorer ---------------------------------------------------

test("open-in-explorer selects a file inside the workdir through the injected launcher", async () => {
  launches.length = 0;
  const response = await shared.postOpen({ project: "one", worker: "t1", path: "sub/inner.png" });
  assert.equal(response.status, 200);
  assert.deepEqual(shared.json(response), { ok: true });
  const real = fs.realpathSync(path.join(work, "sub", "inner.png"));
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].args, [`/select,${real}`]);
  assert.equal(launches[0].isDirectory, false);

  const absolute = await shared.postOpen({ project: "one", worker: "t1", path: path.join(work, "notes.txt") });
  assert.equal(absolute.status, 200, "any extension may be shown in Explorer");
  assert.deepEqual(launches[1].args, [`/select,${path.join(work, "notes.txt")}`]);
});

test("open-in-explorer opens a folder by its path alone", async () => {
  launches.length = 0;
  const response = await shared.postOpen({ project: "one", worker: "t1", path: "sub" });
  assert.equal(response.status, 200);
  assert.deepEqual(launches[0].args, [path.join(work, "sub")]);
  assert.equal(launches[0].isDirectory, true);
});

test("open-in-explorer refuses a POST without Origin or with a foreign one", async () => {
  launches.length = 0;
  const payload = JSON.stringify({ project: "one", worker: "t1", path: "shot.png" });
  const missing = await shared.call("POST", "/api/open-in-explorer", { headers: { "Content-Type": "application/json" }, body: payload });
  assert.equal(missing.status, 403);
  const foreign = await shared.call("POST", "/api/open-in-explorer", {
    headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
    body: payload
  });
  assert.equal(foreign.status, 403);
  const nullOrigin = await shared.call("POST", "/api/open-in-explorer", {
    headers: { "Content-Type": "application/json", Origin: "null" },
    body: payload
  });
  assert.equal(nullOrigin.status, 403);
  assert.equal(launches.length, 0);
});

test("open-in-explorer requires an application/json body", async () => {
  launches.length = 0;
  const payload = JSON.stringify({ project: "one", worker: "t1", path: "shot.png" });
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const response = await shared.postOpen(payload, { "Content-Type": type });
    assert.equal(response.status, 415, type);
  }
  const noType = await shared.call("POST", "/api/open-in-explorer", { headers: { Origin: shared.origin }, body: payload });
  assert.equal(noType.status, 415);
  assert.equal((await shared.postOpen(payload, { "Content-Type": "Application/JSON; charset=utf-8" })).status, 200);
  assert.equal(launches.length, 1);
});

test("open-in-explorer refuses paths outside the workdir and unknown targets", async () => {
  launches.length = 0;
  const cases = [
    [{ project: "one", worker: "t1", path: "../outside/secret.png" }, 403],
    [{ project: "one", worker: "t1", path: path.join(outside, "secret.txt") }, 403],
    [{ project: "one", worker: "t1", path: path.join(`${work}x`, "leak.png") }, 403],
    [{ project: "one", worker: "t1", path: "\\\\evil.example\\share" }, 403],
    [{ project: "one", worker: "t1", path: outside }, 403],
    [{ project: "one", worker: "t1", path: "missing.png" }, 404],
    [{ project: "nope", worker: "t1", path: "shot.png" }, 404],
    [{ project: "one", worker: "nope", path: "shot.png" }, 404],
    [{ project: "one", worker: "t1" }, 400],
    [{ project: "one", worker: "t1", path: 42 }, 400],
    [{ project: ["one"], worker: "t1", path: "shot.png" }, 200]
  ];
  for (const [payload, status] of cases) {
    const response = await shared.postOpen(payload);
    assert.equal(response.status, status, JSON.stringify(payload));
  }
  if (hasJunction) assert.equal((await shared.postOpen({ project: "one", worker: "t1", path: "escape/secret.png" })).status, 403);
  assert.equal(launches.length, 1, "only the case that falls back to the first project launched");
});

test("open-in-explorer rejects malformed and oversized bodies", async () => {
  launches.length = 0;
  assert.equal((await shared.postOpen("{ not json")).status, 400);
  assert.equal((await shared.postOpen("[1,2]")).status, 400);
  assert.equal((await shared.postOpen("null")).status, 400);
  const big = JSON.stringify({ project: "one", worker: "t1", path: "a".repeat(5000) });
  assert.equal((await shared.postOpen(big)).status, 413);
  const chunked = await shared.call("POST", "/api/open-in-explorer", {
    headers: { "Content-Type": "application/json", Origin: shared.origin },
    body: ['{"project":"one","worker":"t1","path":"', "a".repeat(3000), "a".repeat(3000), '"}'],
    chunked: true
  });
  assert.equal(chunked.status, 413);
  assert.equal(launches.length, 0);
});

test("open-in-explorer answers 501 where it cannot run and never uses GET", async () => {
  const linux = await startServer({ platform: "linux", execFile: async () => { throw new Error("no git"); } });
  const response = await linux.postOpen({ project: "one", worker: "t1", path: "shot.png" });
  assert.equal(response.status, 501);
  assert.equal((await shared.call("GET", "/api/open-in-explorer?project=one&worker=t1&path=shot.png")).status, 404);
});

// ---- The same-origin guard still comes first ---------------------------------

test("every new route answers 403 when the Host or Origin check fails", async () => {
  const routes = [
    ["GET", fileUrl("shot.png")],
    ["HEAD", fileUrl("shot.png")],
    ["GET", infoUrl("shot.png")],
    ["GET", "/api/tree?project=one&worker=t1"],
    ["POST", "/api/open-in-explorer"]
  ];
  const payload = JSON.stringify({ project: "one", worker: "t1", path: "shot.png" });
  for (const [method, target] of routes) {
    const bad = [
      { host: "evil.test:4200" },
      { host: `127.0.0.1:${shared.port + 1}` },
      { host: `127.0.0.1:${shared.port}`, Origin: "http://evil.test" },
      { host: `127.0.0.1:${shared.port}`, Origin: "null" }
    ];
    for (const headers of bad) {
      launches.length = 0;
      const response = await shared.call(method, target, {
        headers: { "Content-Type": "application/json", ...(method === "POST" ? { Origin: shared.origin } : {}), ...headers },
        body: method === "POST" ? payload : undefined
      });
      assert.equal(response.status, 403, `${method} ${target} ${JSON.stringify(headers)}`);
      assert.equal(response.body.includes(PNG), false);
      assert.equal(launches.length, 0);
    }
  }
});

// ---- Pure helpers ------------------------------------------------------------

test("isInside compares with a trailing separator and ignores case on Windows", () => {
  const root = path.join(path.parse(os.tmpdir()).root, "a", "b");
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(root, "c", "d.png")), true);
  assert.equal(isInside(root, `${root}c`), false);
  assert.equal(isInside(root, path.join(`${root}c`, "d.png")), false);
  assert.equal(isInside(root, path.dirname(root)), false);
  assert.equal(isInside(path.parse(root).root, root), true);
  assert.equal(isInside(root, path.join(root.toUpperCase(), "x")), WINDOWS);
});

test("resolveContained returns the real path of an allowed file and a status otherwise", () => {
  const ok = resolveContained(work, "sub/inner.png");
  assert.equal(ok.ok, true);
  assert.equal(ok.real, path.join(work, "sub", "inner.png"));
  assert.equal(ok.root, work);
  assert.deepEqual(resolveContained(work, "../outside/secret.png"), { ok: false, status: 403, error: "path outside the worker folder" });
  assert.equal(resolveContained(path.join(base, "missing"), "x.png").status, 404);
  assert.equal(resolveContained(work, undefined).status, 400);
});

test("parseRange accepts one range and rejects everything else", () => {
  assert.deepEqual(parseRange(undefined, 100), { type: "none" });
  assert.deepEqual(parseRange("bytes=0-9", 100), { type: "range", start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { type: "range", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { type: "range", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-500", 100), { type: "range", start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=50-5000", 100), { type: "range", start: 50, end: 99 });
  assert.deepEqual(parseRange("BYTES=0-0", 100), { type: "range", start: 0, end: 0 });
  for (const bad of ["bytes=100-", "bytes=9-1", "bytes=", "bytes=-", "bytes=-0", "bytes=0-1,3-4", "bytes=a-b", "chars=0-1", "bytes=99999999999999999-"]) {
    assert.deepEqual(parseRange(bad, 100), { type: "invalid" }, bad);
  }
});

test("kindOf and the type table agree and never include scripts or HTML", () => {
  assert.equal(kindOf("a.PNG"), "image");
  assert.equal(kindOf("a.svg"), "image");
  assert.equal(kindOf("a.mp4"), "video");
  assert.equal(kindOf("a.mp3"), "audio");
  assert.equal(kindOf("a.pdf"), "pdf");
  assert.equal(kindOf("a.txt"), "other");
  assert.equal(kindOf("noextension"), "other");
  assert.deepEqual(Object.keys(FILE_TYPES).sort(), [".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".ogg", ".pdf", ".png", ".svg", ".wav", ".webm", ".webp"]);
  for (const type of Object.values(FILE_TYPES)) assert.doesNotMatch(type, /html|javascript|^text\/|^application\/xml/);
});

test("Explorer is started with an argument array, detached, without a shell", () => {
  assert.deepEqual(explorerArguments("C:\\w\\a b.png", false), ["/select,C:\\w\\a b.png"]);
  assert.deepEqual(explorerArguments("C:\\w\\dir", true), ["C:\\w\\dir"]);

  const seen = [];
  const child = { unrefs: 0, on() {}, unref() { this.unrefs += 1; } };
  spawnExplorer(["/select,C:\\w\\a.png"], (...call) => {
    seen.push(call);
    return child;
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "explorer.exe");
  assert.deepEqual(seen[0][1], ["/select,C:\\w\\a.png"]);
  assert.deepEqual(seen[0][2], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
  assert.equal(child.unrefs, 1);
});

test("PDFs are served without the sandbox CSP so Chrome's viewer can render them", async () => {
  const { fileHeaders } = await import("../lib/files.mjs");
  assert.equal(fileHeaders("application/pdf")["Content-Security-Policy"], undefined);
  assert.equal(fileHeaders("application/pdf")["X-Content-Type-Options"], "nosniff");
  assert.match(fileHeaders("image/svg+xml")["Content-Security-Policy"], /^sandbox;/);
});