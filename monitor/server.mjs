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

import { buildSnapshot, loadConfig, resolveProjects } from "./lib/state.mjs";

const DEFAULT_CONFIG = "fleet-monitor.config.json";
const STATIC_TYPES = {
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

export function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host).toLowerCase());
}

export function routeRequest(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return null;
  if (pathname === "/" || pathname === "/index.html") return "index";
  if (pathname === "/api/projects") return "projects";
  if (pathname === "/api/state") return "state";
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

  return async function handleRequest(request, response) {
    let url;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      url = new URL("/", "http://127.0.0.1");
    }
    const pathname = url.pathname;
    const route = routeRequest(request.method, pathname);

    if (route === "index") {
      try {
        const html = fs.readFileSync(indexFile);
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(request.method === "HEAD" ? undefined : html);
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("index.html no encontrado");
      }
      return;
    }

    if (route === "font") {
      const file = resolveStaticFile(path.join(serverDir, "public"), pathname);
      const type = file ? STATIC_TYPES[path.extname(file).toLowerCase()] : null;
      if (!file || !type) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("No encontrado");
        return;
      }
      try {
        const data = fs.readFileSync(file);
        response.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "public, max-age=86400"
        });
        response.end(request.method === "HEAD" ? undefined : data);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("No encontrado");
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
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(request.method === "HEAD" ? undefined : body);
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
          response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          response.end(request.method === "HEAD" ? undefined : JSON.stringify({ error: "unknown project" }));
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
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
      return;
    }

    const knownMethod = request.method === "GET" || request.method === "HEAD";
    response.writeHead(knownMethod ? 404 : 405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(knownMethod ? "No encontrado" : "Método no permitido");
  };
}

export function createServer(config, options = {}) {
  const host = isLoopback(config.server?.host) ? String(config.server.host) : "127.0.0.1";
  const port = Number(config.server?.port) || 4200;
  const server = http.createServer(createRequestHandler(config, options));
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
