#!/usr/bin/env node
// Read-only local server for the fleet monitor. Node built-ins only, no npm
// dependencies. It binds loopback only, serves index.html and one JSON
// snapshot, and never writes, kills or launches anything except read-only git
// and system-info commands, the git-ignored Spanish translation cache, the
// background helper calls of the translate service and, on an explicit POST
// from its own page, Windows Explorer pointed at a file inside a worker folder
// (see lib/files.mjs for the containment rules of the file endpoints). The configuration is
// re-read on every /api/state, so edits to fleet-monitor.config.json show up
// without a restart.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  explorerArguments,
  fileHeaders,
  FILE_TYPES,
  kindOf,
  listTree,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  parseRange,
  resolveContained,
  spawnExplorer,
  TREE_CACHE_MS,
  TREE_LIMIT
} from "./lib/files.mjs";
import { buildSnapshot, buildWorkerSteps, loadConfig, resolveProjects, resolveWorkerWorkdir } from "./lib/state.mjs";

const DEFAULT_CONFIG = "fleet-monitor.config.json";
const STATIC_TYPES = {
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

export function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host).toLowerCase());
}

// Same-origin guard. Only the monitor's own page may call the server: the Host
// must name the exact loopback address and port it listens on (DNS rebinding
// defense) and, when the browser sent an Origin, it must be the same origin.
// Pure so it is unit-testable.
export function isAllowedRequest(headers, port) {
  const host = String(headers?.host ?? "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  const origin = headers?.origin;
  if (origin === undefined || origin === null || origin === "") return true;
  const normalized = String(origin).toLowerCase().replace(/\/+$/, "");
  return normalized === `http://127.0.0.1:${port}` || normalized === `http://localhost:${port}`;
}

// Every response leaves with nosniff so a browser never reinterprets a body.
export function send(response, status, contentType, body, cache = "no-store", extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(body);
}

export function routeRequest(method, pathname) {
  // The one write-like route is a POST, so a stray cross-site form or GET can
  // never reach it.
  if (method === "POST") return pathname === "/api/open-in-explorer" ? "open" : null;
  if (method !== "GET" && method !== "HEAD") return null;
  if (pathname === "/" || pathname === "/index.html") return "index";
  if (pathname === "/api/projects") return "projects";
  if (pathname === "/api/state") return "state";
  if (pathname === "/api/steps") return "steps";
  if (pathname === "/api/file") return "file";
  if (pathname === "/api/file-info") return "file-info";
  if (pathname === "/api/tree") return "tree";
  if (pathname.startsWith("/fonts/")) return "font";
  if (pathname.startsWith("/js/")) return "script";
  return null;
}

// Resolves a request pathname inside a public root. The decoded path may hold
// traversal segments (`..`, encoded dots, backslashes), so the result must
// still sit under the root; anything else returns null.
export function resolveStaticFile(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathname));
  } catch {
    return null;
  }
  const root = path.resolve(rootDir);
  const file = path.resolve(root, `.${decoded}`);
  return file.startsWith(root + path.sep) ? file : null;
}

// Re-reads the configuration for one request. On any read/parse error the last
// good configuration is kept and the error is reported as a notice.
export function readRequestConfig(configPath, fallback = null) {
  if (!configPath) return { config: fallback, error: null };
  try {
    return { config: loadConfig(configPath), error: null };
  } catch (error) {
    return { config: fallback, error: String(error?.message ?? error) };
  }
}

// Reads a request body up to `limit` bytes; rejects with code TOO_LARGE past it.
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export function createRequestHandler(config, options = {}) {
  const serverDir = options.serverDir ?? path.dirname(fileURLToPath(import.meta.url));
  const indexFile = path.join(serverDir, "index.html");
  const configPath = options.configPath ?? config?.__file ?? null;
  const now = options.now ?? (() => new Date());
  const build = options.buildSnapshot ?? buildSnapshot;
  const buildSteps = options.buildWorkerSteps ?? buildWorkerSteps;
  const port = Number(options.port ?? config?.server?.port) || 4200;
  const stepsCache = new Map();

  // Steps are computed on request and cached per project + worker for
  // pollSeconds, exactly like the other expensive reads. A missing worker is
  // never cached so it can appear as soon as its track exists.
  async function readSteps(configForSteps, project, worker) {
    const ttlMs = (Number(configForSteps.pollSeconds) || 5) * 1000;
    const key = `${project.id}\u0000${worker}`;
    const at = now();
    const hit = stepsCache.get(key);
    if (hit && at.getTime() - hit.at < ttlMs) return hit.value;
    const value = await buildSteps(configForSteps, { project, worker, now: at });
    if (value) stepsCache.set(key, { at: at.getTime(), value });
    return value;
  }

  // ---- File endpoints -------------------------------------------------------
  // /api/file, /api/file-info, /api/tree and /api/open-in-explorer all start
  // from a project + worker pair and never from a path the client invents: the
  // worker's own folder is the only root a path is ever checked against.
  const resolveWorkdir = options.resolveWorkdir ?? resolveWorkerWorkdir;
  const platform = options.platform ?? process.platform;
  const treeLimit = Number(options.treeLimit) > 0 ? Number(options.treeLimit) : TREE_LIMIT;
  const maxFileBytes = Number(options.maxFileBytes) > 0 ? Number(options.maxFileBytes) : MAX_FILE_BYTES;
  const treeCache = new Map();

  function sendJson(request, response, status, value, extraHeaders = {}) {
    send(
      response,
      status,
      "application/json; charset=utf-8",
      request.method === "HEAD" ? undefined : JSON.stringify(value),
      "no-store",
      extraHeaders
    );
  }

  async function locateWorker(requestedProject, worker) {
    const reloaded = readRequestConfig(configPath, config);
    const projects = resolveProjects(reloaded.config);
    const wanted = typeof requestedProject === "string" && requestedProject ? requestedProject : null;
    const project = wanted ? projects.find((item) => item.id === wanted) : projects[0];
    if (!project) return { status: 404, error: "unknown project" };
    const name = typeof worker === "string" ? worker : "";
    const workdir = name ? await resolveWorkdir(reloaded.config, { project, worker: name }) : null;
    if (!workdir) return { status: 404, error: "unknown worker" };
    return { project, worker: name, workdir };
  }

  // Containment + existence for one requested path. Returns the real path and
  // its stat (bigint, so the identity check below can compare file ids).
  function locateFile(located, requestedPath) {
    const found = resolveContained(located.workdir, requestedPath);
    if (!found.ok) return found;
    try {
      return { ...found, stat: fs.statSync(found.real, { bigint: true }) };
    } catch {
      return { ok: false, status: 404, error: "file not found" };
    }
  }

  async function serveFile(request, response, url, route) {
    const located = await locateWorker(url.searchParams.get("project"), url.searchParams.get("worker"));
    if (located.error) return sendJson(request, response, located.status, { error: located.error });
    const found = locateFile(located, url.searchParams.get("path"));
    if (!found.ok) return sendJson(request, response, found.status, { error: found.error });
    if (found.stat.isDirectory()) return sendJson(request, response, 400, { error: "path is a directory" });
    if (!found.stat.isFile()) return sendJson(request, response, 403, { error: "not a regular file" });

    if (route === "file-info") {
      return sendJson(request, response, 200, {
        name: path.basename(found.real),
        path: found.real,
        size: Number(found.stat.size),
        modified: found.stat.mtime.toISOString(),
        kind: kindOf(found.real)
      });
    }

    // The type comes from the REAL file's extension, so a link named `a.png`
    // that points at a script is refused instead of served as an image.
    const type = FILE_TYPES[path.extname(found.real).toLowerCase()];
    if (!type) return sendJson(request, response, 415, { error: "file type not allowed" });
    const size = Number(found.stat.size);
    if (size > maxFileBytes) return sendJson(request, response, 413, { error: "file too large" });
    const range = parseRange(request.headers.range, size);
    if (range.type === "invalid") {
      return sendJson(request, response, 416, { error: "range not satisfiable" }, { "Content-Range": `bytes */${size}` });
    }

    let handle;
    try {
      handle = await fs.promises.open(found.real, "r");
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : error?.code === "EACCES" || error?.code === "EPERM" ? 403 : 500;
      return sendJson(request, response, status, { error: "file not readable" });
    }
    try {
      // Re-check after the open: the handle must be the very file that was
      // checked, and its path must still resolve to the same place inside.
      const opened = await handle.stat({ bigint: true });
      const again = resolveContained(located.workdir, found.real);
      if (!opened.isFile() || opened.dev !== found.stat.dev || opened.ino !== found.stat.ino || !again.ok || again.real !== found.real) {
        await handle.close();
        return sendJson(request, response, 403, { error: "file changed while opening" });
      }
    } catch {
      await handle.close().catch(() => {});
      return sendJson(request, response, 500, { error: "file not readable" });
    }

    const start = range.type === "range" ? range.start : 0;
    const end = range.type === "range" ? range.end : size - 1;
    const headers = { ...fileHeaders(type), "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(size === 0 ? 0 : end - start + 1) };
    if (range.type === "range") headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    response.writeHead(range.type === "range" ? 206 : 200, headers);
    if (request.method === "HEAD" || size === 0) {
      await handle.close().catch(() => {});
      response.end();
      return;
    }
    pipeline(handle.createReadStream({ start, end }), response, () => {});
  }

  async function serveTree(request, response, url) {
    const located = await locateWorker(url.searchParams.get("project"), url.searchParams.get("worker"));
    if (located.error) return sendJson(request, response, located.status, { error: located.error });
    let root;
    try {
      root = fs.realpathSync(located.workdir);
    } catch {
      return sendJson(request, response, 404, { error: "worker folder not found" });
    }
    const key = `${located.project.id}\u0000${located.worker}`;
    const at = now().getTime();
    let entry = treeCache.get(key);
    if (!entry || at - entry.at >= TREE_CACHE_MS || entry.root !== root) {
      const promise = listTree(root, { limit: treeLimit, execFile: options.execFile });
      entry = { at, root, promise };
      treeCache.set(key, entry);
      // A failed listing is never cached.
      promise.catch(() => {
        if (treeCache.get(key) === entry) treeCache.delete(key);
      });
    }
    const listing = await entry.promise;
    return sendJson(request, response, 200, { root, files: listing.files, truncated: listing.truncated });
  }

  async function openInExplorer(request, response) {
    // Without an Origin the POST did not come from our page (the browser always
    // sends one on a POST), so it is refused before anything else is read.
    if (!request.headers.origin) return sendJson(request, response, 403, { error: "missing origin" });
    const mediaType = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") return sendJson(request, response, 415, { error: "content type must be application/json" });
    const launcher = options.openInExplorer ?? (platform === "win32" ? spawnExplorer : null);
    if (!launcher) return sendJson(request, response, 501, { error: "not supported on this platform" });
    if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
      return sendJson(request, response, 413, { error: "body too large" });
    }
    let body;
    try {
      body = JSON.parse((await readBody(request, MAX_BODY_BYTES)).toString("utf8"));
    } catch (error) {
      if (error?.code === "TOO_LARGE") return sendJson(request, response, 413, { error: "body too large" });
      return sendJson(request, response, 400, { error: "invalid JSON body" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJson(request, response, 400, { error: "invalid JSON body" });
    }
    const located = await locateWorker(body.project, body.worker);
    if (located.error) return sendJson(request, response, located.status, { error: located.error });
    const found = locateFile(located, body.path);
    if (!found.ok) return sendJson(request, response, found.status, { error: found.error });
    const isDirectory = found.stat.isDirectory();
    if (!isDirectory && !found.stat.isFile()) return sendJson(request, response, 403, { error: "not a regular file" });
    await launcher(explorerArguments(found.real, isDirectory), { realPath: found.real, isDirectory });
    return sendJson(request, response, 200, { ok: true });
  }

  return async function handleRequest(request, response) {
    if (!isAllowedRequest(request.headers, port)) {
      send(response, 403, "text/plain; charset=utf-8", "Prohibido");
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      url = new URL("/", "http://127.0.0.1");
    }
    const pathname = url.pathname;
    const route = routeRequest(request.method, pathname);

    if (route === "index") {
      let html;
      try {
        html = fs.readFileSync(indexFile);
      } catch {
        send(response, 500, "text/plain; charset=utf-8", "index.html no encontrado");
        return;
      }
      send(response, 200, "text/html; charset=utf-8", request.method === "HEAD" ? undefined : html);
      return;
    }

    if (route === "font" || route === "script") {
      const file = resolveStaticFile(path.join(serverDir, "public"), pathname);
      const type = file ? STATIC_TYPES[path.extname(file).toLowerCase()] : null;
      if (!file || !type) {
        send(response, 404, "text/plain; charset=utf-8", "No encontrado");
        return;
      }
      try {
        const data = fs.readFileSync(file);
        // The font is immutable enough to cache; the viewer module is read on
        // every reload so a local edit shows up without clearing the cache.
        const cache = route === "font" ? "public, max-age=86400" : "no-store";
        send(response, 200, type, request.method === "HEAD" ? undefined : data, cache);
      } catch {
        send(response, 404, "text/plain; charset=utf-8", "No encontrado");
      }
      return;
    }

    if (route === "projects") {
      const reloaded = readRequestConfig(configPath, config);
      const projects = resolveProjects(reloaded.config);
      const body = JSON.stringify({
        projects: projects.map(({ id, name }) => ({ id, name })),
        defaultId: projects[0]?.id ?? null
      });
      send(response, 200, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : body);
      return;
    }

    if (route === "state") {
      try {
        const reloaded = readRequestConfig(configPath, config);
        const projects = resolveProjects(reloaded.config);
        // Without the parameter the first project wins, exactly like a config
        // without `projects` keeps its single default one.
        const requested = url.searchParams.get("project");
        const project = requested ? projects.find((item) => item.id === requested) : projects[0];
        if (!project) {
          send(response, 404, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : JSON.stringify({ error: "unknown project" }));
          return;
        }
        const snapshot = await build(reloaded.config, { now: now(), project });
        if (reloaded.error) {
          snapshot.notices = [
            ...(Array.isArray(snapshot.notices) ? snapshot.notices : []),
            `No se pudo releer la configuración: ${reloaded.error}`
          ];
        }
        const body = JSON.stringify(snapshot);
        send(response, 200, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : body);
      } catch (error) {
        send(response, 500, "application/json; charset=utf-8", JSON.stringify({ error: String(error?.message ?? error) }));
      }
      return;
    }

    if (route === "steps") {
      try {
        const reloaded = readRequestConfig(configPath, config);
        const projects = resolveProjects(reloaded.config);
        const requested = url.searchParams.get("project");
        const project = requested ? projects.find((item) => item.id === requested) : projects[0];
        if (!project) {
          send(response, 404, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : JSON.stringify({ error: "unknown project" }));
          return;
        }
        const worker = String(url.searchParams.get("worker") ?? "");
        const result = await readSteps(reloaded.config, project, worker);
        if (!result) {
          send(response, 404, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : JSON.stringify({ error: "unknown worker" }));
          return;
        }
        // Unknown or missing `since` means every step.
        const since = url.searchParams.get("since");
        const at = since ? result.steps.findIndex((step) => step.id === since) : -1;
        const body = {
          project: project.id,
          worker,
          steps: at >= 0 ? result.steps.slice(at + 1) : result.steps
        };
        if (result.unsupported) body.unsupported = true;
        if (result.notice) body.notice = result.notice;
        send(response, 200, "application/json; charset=utf-8", request.method === "HEAD" ? undefined : JSON.stringify(body));
      } catch (error) {
        send(response, 500, "application/json; charset=utf-8", JSON.stringify({ error: String(error?.message ?? error) }));
      }
      return;
    }

    if (route === "file" || route === "file-info" || route === "tree" || route === "open") {
      try {
        if (route === "open") await openInExplorer(request, response);
        else if (route === "tree") await serveTree(request, response, url);
        else await serveFile(request, response, url, route);
      } catch {
        // Details stay out of the reply: they would carry local paths.
        if (!response.headersSent) sendJson(request, response, 500, { error: "internal error" });
        else response.destroy();
      }
      return;
    }

    const knownMethod = request.method === "GET" || request.method === "HEAD";
    send(
      response,
      knownMethod ? 404 : 405,
      "text/plain; charset=utf-8",
      knownMethod ? "No encontrado" : "Método no permitido"
    );
  };
}

export function createServer(config, options = {}) {
  const host = isLoopback(config.server?.host) ? String(config.server.host) : "127.0.0.1";
  const port = Number(config.server?.port) || 4200;
  const server = http.createServer(createRequestHandler(config, { ...options, port }));
  return { server, host, port };
}

async function main() {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const argument = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
  const configPath = path.resolve(argument || process.env.FLEET_MONITOR_CONFIG || path.join(serverDir, DEFAULT_CONFIG));
  const config = loadConfig(configPath);
  const { server, host, port } = createServer(config, { serverDir, configPath });
  server.listen(port, host, () => {
    console.log(`fleet-monitor escuchando en http://${host}:${port}/`);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(`fleet-monitor no pudo arrancar: ${error?.message ?? error}`);
    process.exit(1);
  });
}
