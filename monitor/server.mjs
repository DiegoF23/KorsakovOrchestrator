#!/usr/bin/env node
// Read-only local server for the fleet monitor. Node built-ins only, no npm
// dependencies. It binds loopback only, serves index.html and one JSON
// snapshot, and never writes, kills or launches anything except read-only git
// and system-info commands, the git-ignored Spanish translation cache and the
// background helper calls of the translate service. The configuration is
// re-read on every /api/state, so edits to fleet-monitor.config.json show up
// without a restart.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSnapshot, buildWorkerSteps, loadConfig, resolveProjects } from "./lib/state.mjs";

const DEFAULT_CONFIG = "fleet-monitor.config.json";
const STATIC_TYPES = {
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
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
export function send(response, status, contentType, body, cache = "no-store") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

export function routeRequest(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return null;
  if (pathname === "/" || pathname === "/index.html") return "index";
  if (pathname === "/api/projects") return "projects";
  if (pathname === "/api/state") return "state";
  if (pathname === "/api/steps") return "steps";
  if (pathname.startsWith("/fonts/")) return "font";
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

    if (route === "font") {
      const file = resolveStaticFile(path.join(serverDir, "public"), pathname);
      const type = file ? STATIC_TYPES[path.extname(file).toLowerCase()] : null;
      if (!file || !type) {
        send(response, 404, "text/plain; charset=utf-8", "No encontrado");
        return;
      }
      try {
        const data = fs.readFileSync(file);
        send(response, 200, type, request.method === "HEAD" ? undefined : data, "public, max-age=86400");
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
