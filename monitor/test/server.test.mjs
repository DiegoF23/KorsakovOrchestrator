import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRequestHandler, isLoopback, readRequestConfig, resolveStaticFile, routeRequest } from "../server.mjs";

function tempConfig(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-monitor-"));
  const file = path.join(dir, "fleet-monitor.config.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

function mockResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

test("only loopback hosts are accepted for binding", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("localhost"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("0.0.0.0"), false);
  assert.equal(isLoopback("192.168.1.10"), false);
});

test("the router only answers the page, the read-only snapshot and the fonts", () => {
  assert.equal(routeRequest("GET", "/"), "index");
  assert.equal(routeRequest("GET", "/index.html"), "index");
  assert.equal(routeRequest("GET", "/api/projects"), "projects");
  assert.equal(routeRequest("HEAD", "/api/projects"), "projects");
  assert.equal(routeRequest("GET", "/api/state"), "state");
  assert.equal(routeRequest("HEAD", "/api/state"), "state");
  assert.equal(routeRequest("GET", "/fonts/share-tech-mono.woff2"), "font");
  assert.equal(routeRequest("HEAD", "/fonts/OFL.txt"), "font");
  assert.equal(routeRequest("GET", "/../secret"), null);
  assert.equal(routeRequest("GET", "/api"), null);
  assert.equal(routeRequest("POST", "/api/projects"), null);
  assert.equal(routeRequest("POST", "/api/state"), null);
  assert.equal(routeRequest("POST", "/fonts/x.woff2"), null);
  assert.equal(routeRequest("DELETE", "/"), null);
});

test("resolveStaticFile keeps every file inside the public root", () => {
  const root = path.join(os.tmpdir(), "fleet-monitor-public");
  assert.equal(resolveStaticFile(root, "/fonts/a.woff2"), path.join(root, "fonts", "a.woff2"));
  assert.equal(resolveStaticFile(root, "/fonts/%2e%2e/server.mjs"), path.join(root, "server.mjs"));
  assert.equal(resolveStaticFile(root, "/fonts/..%2f..%2fsecret.txt"), null);
  assert.equal(resolveStaticFile(root, "/fonts/%E0%A4%A.woff2"), null);
});

test("the handler serves the bundled font and rejects unknown or escaping paths", async () => {
  const handler = createRequestHandler({});
  const font = mockResponse();
  await handler({ method: "GET", url: "/fonts/share-tech-mono.woff2" }, font);
  assert.equal(font.status, 200);
  assert.match(font.headers["Content-Type"], /font\/woff2/);
  assert.ok(font.body.length > 1000);

  const license = mockResponse();
  await handler({ method: "GET", url: "/fonts/OFL.txt" }, license);
  assert.equal(license.status, 200);
  assert.match(license.headers["Content-Type"], /text\/plain/);

  const escaping = mockResponse();
  await handler({ method: "GET", url: "/fonts/%2e%2e%2fserver.mjs" }, escaping);
  assert.equal(escaping.status, 404);

  const unknown = mockResponse();
  await handler({ method: "GET", url: "/fonts/evil.exe" }, unknown);
  assert.equal(unknown.status, 404);

  const head = mockResponse();
  await handler({ method: "HEAD", url: "/fonts/share-tech-mono.woff2" }, head);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
});

test("readRequestConfig re-reads the file and falls back on parse errors", () => {
  const file = tempConfig({ orchestrator: { model: "one" } });

  const first = readRequestConfig(file, null);
  assert.equal(first.error, null);
  assert.equal(first.config.orchestrator.model, "one");

  fs.writeFileSync(file, JSON.stringify({ orchestrator: { model: "two" } }));
  const second = readRequestConfig(file, first.config);
  assert.equal(second.config.orchestrator.model, "two");

  fs.writeFileSync(file, "{ this is not json");
  const third = readRequestConfig(file, second.config);
  assert.equal(third.config.orchestrator.model, "two");
  assert.match(third.error, /./);
});

test("every /api/state request re-reads the configuration file", async () => {
  const file = tempConfig({ orchestrator: { model: "one" }, server: { host: "127.0.0.1", port: 4200 } });
  const seen = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    buildSnapshot: async (config) => {
      seen.push(config.orchestrator.model);
      return { notices: [], generatedAt: "2026-10-03T12:00:00.000Z" };
    }
  });

  const first = mockResponse();
  await handler({ method: "GET", url: "/api/state" }, first);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body).notices, []);

  fs.writeFileSync(file, JSON.stringify({ orchestrator: { model: "two" } }));
  const second = mockResponse();
  await handler({ method: "GET", url: "/api/state" }, second);
  assert.deepEqual(seen, ["one", "two"]);
});

test("a broken configuration keeps the last one and adds a notice", async () => {
  const file = tempConfig({ orchestrator: { model: "one" } });
  const seen = [];
  const handler = createRequestHandler({ __file: file, orchestrator: { model: "one" } }, {
    serverDir: path.dirname(file),
    configPath: file,
    buildSnapshot: async (config) => {
      seen.push(config.orchestrator.model);
      return { notices: [] };
    }
  });

  await handler({ method: "GET", url: "/api/state" }, mockResponse());
  fs.writeFileSync(file, "{ this is not json");
  const broken = mockResponse();
  await handler({ method: "GET", url: "/api/state" }, broken);

  assert.deepEqual(seen, ["one", "one"]);
  const snapshot = JSON.parse(broken.body);
  assert.equal(snapshot.notices.length, 1);
  assert.match(snapshot.notices[0], /No se pudo releer la configuración/);
});

test("/api/projects lists every project with the first id as default", async () => {
  const file = tempConfig({
    projects: [
      { id: "korsakov", name: "Korsakov Orchestrator", repo: ".", kitConfig: "./k.json" },
      { id: "web", name: "Web" }
    ]
  });
  const handler = createRequestHandler({ __file: file }, { serverDir: path.dirname(file), configPath: file });

  const response = mockResponse();
  await handler({ method: "GET", url: "/api/projects" }, response);

  assert.equal(response.status, 200);
  assert.match(response.headers["Content-Type"], /application\/json/);
  assert.deepEqual(JSON.parse(response.body), {
    projects: [
      { id: "korsakov", name: "Korsakov Orchestrator" },
      { id: "web", name: "Web" }
    ],
    defaultId: "korsakov"
  });
});

test("/api/projects falls back to the implicit default project", async () => {
  const file = tempConfig({ repo: "." });
  const handler = createRequestHandler({ __file: file }, { serverDir: path.dirname(file), configPath: file });

  const response = mockResponse();
  await handler({ method: "GET", url: "/api/projects" }, response);

  const body = JSON.parse(response.body);
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].id, "default");
  assert.equal(body.defaultId, "default");
});

test("/api/state?project=<id> builds the snapshot of the chosen project", async () => {
  const file = tempConfig({
    projects: [
      { id: "one", name: "One", repo: "." },
      { id: "two", name: "Two", repo: "." }
    ]
  });
  const seen = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    buildSnapshot: async (config, options) => {
      seen.push(options.project.id);
      return { notices: [], project: { id: options.project.id, name: options.project.name } };
    }
  });

  const response = mockResponse();
  await handler({ method: "GET", url: "/api/state?project=two" }, response);

  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["two"]);
  assert.deepEqual(JSON.parse(response.body).project, { id: "two", name: "Two" });
});

test("the state falls back to the first project and rejects an unknown id with 404", async () => {
  const file = tempConfig({
    projects: [
      { id: "one", name: "One", repo: "." },
      { id: "two", name: "Two", repo: "." }
    ]
  });
  const seen = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    buildSnapshot: async (config, options) => {
      seen.push(options.project.id);
      return { notices: [] };
    }
  });

  await handler({ method: "GET", url: "/api/state" }, mockResponse());
  assert.deepEqual(seen, ["one"]);

  const unknown = mockResponse();
  await handler({ method: "GET", url: "/api/state?project=nope" }, unknown);
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: "unknown project" });
  assert.deepEqual(seen, ["one"], "an unknown project never builds a snapshot");
});
