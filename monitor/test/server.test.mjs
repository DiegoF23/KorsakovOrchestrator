import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createRequestHandler,
  isAllowedRequest,
  isLoopback,
  readRequestConfig,
  resolveStaticFile,
  routeRequest
} from "../server.mjs";

// Every handler call now needs the same-origin Host the browser would send;
// these tests run on the default port 4200.
const HOST = { host: "127.0.0.1:4200" };
const request = (method, url, headers = HOST) => ({ method, url, headers });

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

test("isAllowedRequest accepts only the exact loopback host and origin", () => {
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4200" }, 4200), true);
  assert.equal(isAllowedRequest({ host: "localhost:4200" }, 4200), true);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4201" }, 4200), false);
  assert.equal(isAllowedRequest({ host: "evil.test:4200" }, 4200), false);
  assert.equal(isAllowedRequest({ host: "localhost" }, 4200), false);
  assert.equal(isAllowedRequest({}, 4200), false);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4200", origin: "http://127.0.0.1:4200" }, 4200), true);
  assert.equal(isAllowedRequest({ host: "localhost:4200", origin: "http://localhost:4200" }, 4200), true);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4200", origin: "http://localhost:4200" }, 4200), true);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4200", origin: "http://evil.test" }, 4200), false);
  assert.equal(isAllowedRequest({ host: "127.0.0.1:4200", origin: "null" }, 4200), false);
});

test("the router only answers the page, the snapshot, the steps and the fonts", () => {
  assert.equal(routeRequest("GET", "/"), "index");
  assert.equal(routeRequest("GET", "/index.html"), "index");
  assert.equal(routeRequest("GET", "/api/projects"), "projects");
  assert.equal(routeRequest("HEAD", "/api/projects"), "projects");
  assert.equal(routeRequest("GET", "/api/state"), "state");
  assert.equal(routeRequest("HEAD", "/api/state"), "state");
  assert.equal(routeRequest("GET", "/api/steps"), "steps");
  assert.equal(routeRequest("HEAD", "/api/steps"), "steps");
  assert.equal(routeRequest("GET", "/fonts/share-tech-mono.woff2"), "font");
  assert.equal(routeRequest("HEAD", "/fonts/OFL.txt"), "font");
  assert.equal(routeRequest("GET", "/../secret"), null);
  assert.equal(routeRequest("GET", "/api"), null);
  assert.equal(routeRequest("POST", "/api/projects"), null);
  assert.equal(routeRequest("POST", "/api/state"), null);
  assert.equal(routeRequest("POST", "/api/steps"), null);
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

test("the handler serves the page modules and refuses to escape /js/", async () => {
  assert.equal(routeRequest("GET", "/js/live-view.mjs"), "script");
  assert.equal(routeRequest("HEAD", "/js/live-view.mjs"), "script");
  const handler = createRequestHandler({});

  const script = mockResponse();
  await handler(request("GET", "/js/live-view.mjs"), script);
  assert.equal(script.status, 200);
  assert.match(script.headers["Content-Type"], /text\/javascript/);
  assert.ok(script.body.length > 1000);
  assert.equal(script.headers["X-Content-Type-Options"], "nosniff");

  const head = mockResponse();
  await handler(request("HEAD", "/js/live-view.mjs"), head);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);

  const escaping = mockResponse();
  await handler(request("GET", "/js/..%2f..%2fserver.mjs"), escaping);
  assert.equal(escaping.status, 404);

  const unknown = mockResponse();
  await handler(request("GET", "/js/evil.exe"), unknown);
  assert.equal(unknown.status, 404);
});

test("the handler serves the bundled font and rejects unknown or escaping paths", async () => {
  const handler = createRequestHandler({});
  const font = mockResponse();
  await handler(request("GET", "/fonts/share-tech-mono.woff2"), font);
  assert.equal(font.status, 200);
  assert.match(font.headers["Content-Type"], /font\/woff2/);
  assert.ok(font.body.length > 1000);

  const license = mockResponse();
  await handler(request("GET", "/fonts/OFL.txt"), license);
  assert.equal(license.status, 200);
  assert.match(license.headers["Content-Type"], /text\/plain/);

  const escaping = mockResponse();
  await handler(request("GET", "/fonts/%2e%2e%2fserver.mjs"), escaping);
  assert.equal(escaping.status, 404);

  const unknown = mockResponse();
  await handler(request("GET", "/fonts/evil.exe"), unknown);
  assert.equal(unknown.status, 404);

  const head = mockResponse();
  await handler(request("HEAD", "/fonts/share-tech-mono.woff2"), head);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
});

test("the guard rejects a foreign Host or Origin and allows both loopback spellings", async () => {
  const handler = createRequestHandler({});

  const wrongHost = mockResponse();
  await handler(request("GET", "/api/projects", { host: "evil.test:4200" }), wrongHost);
  assert.equal(wrongHost.status, 403);
  assert.match(String(wrongHost.body), /./);

  const wrongPort = mockResponse();
  await handler(request("GET", "/api/projects", { host: "127.0.0.1:4201" }), wrongPort);
  assert.equal(wrongPort.status, 403);

  const foreignOrigin = mockResponse();
  await handler(request("GET", "/api/projects", { host: "127.0.0.1:4200", origin: "http://evil.test" }), foreignOrigin);
  assert.equal(foreignOrigin.status, 403);

  const nullOrigin = mockResponse();
  await handler(request("GET", "/api/projects", { host: "127.0.0.1:4200", origin: "null" }), nullOrigin);
  assert.equal(nullOrigin.status, 403);

  for (const host of ["127.0.0.1:4200", "localhost:4200"]) {
    const allowed = mockResponse();
    await handler(request("GET", "/api/projects", { host }), allowed);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["X-Content-Type-Options"], "nosniff");
  }
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
  await handler(request("GET", "/api/state"), first);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body).notices, []);

  fs.writeFileSync(file, JSON.stringify({ orchestrator: { model: "two" } }));
  const second = mockResponse();
  await handler(request("GET", "/api/state"), second);
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

  await handler(request("GET", "/api/state"), mockResponse());
  fs.writeFileSync(file, "{ this is not json");
  const broken = mockResponse();
  await handler(request("GET", "/api/state"), broken);

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
  await handler(request("GET", "/api/projects"), response);

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
  await handler(request("GET", "/api/projects"), response);

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
  await handler(request("GET", "/api/state?project=two"), response);

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

  await handler(request("GET", "/api/state"), mockResponse());
  assert.deepEqual(seen, ["one"]);

  const unknown = mockResponse();
  await handler(request("GET", "/api/state?project=nope"), unknown);
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: "unknown project" });
  assert.deepEqual(seen, ["one"], "an unknown project never builds a snapshot");
});

function stepsConfig() {
  return tempConfig({
    projects: [
      { id: "one", name: "One", repo: "." },
      { id: "two", name: "Two", repo: "." }
    ],
    pollSeconds: 5
  });
}

test("/api/steps serves the typed steps of a worker and filters by since", async () => {
  const file = stepsConfig();
  const steps = [
    { id: "s1", type: "message" },
    { id: "s2", type: "write" },
    { id: "s3", type: "command" }
  ];
  const seen = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    now: () => new Date("2026-10-05T12:00:00Z"),
    buildWorkerSteps: async (config, options) => {
      seen.push(`${options.project.id}/${options.worker}`);
      return { steps };
    }
  });

  const all = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1"), all);
  assert.equal(all.status, 200);
  assert.match(all.headers["Content-Type"], /application\/json/);
  assert.deepEqual(JSON.parse(all.body), { project: "one", worker: "t1", steps });

  const after = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1&since=s2"), after);
  assert.deepEqual(JSON.parse(after.body).steps.map((step) => step.id), ["s3"]);

  const unknownSince = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1&since=nope"), unknownSince);
  assert.deepEqual(JSON.parse(unknownSince.body).steps.map((step) => step.id), ["s1", "s2", "s3"]);

  assert.deepEqual(seen, ["one/t1"], "the repeated polls hit the per-worker cache");
});

test("/api/steps caches the steps per project and worker for pollSeconds", async () => {
  const file = stepsConfig();
  let clock = new Date("2026-10-05T12:00:00Z").getTime();
  const calls = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    now: () => new Date(clock),
    buildWorkerSteps: async (config, options) => {
      calls.push(`${options.project.id}/${options.worker}`);
      return { steps: [{ id: `s${calls.length}` }] };
    }
  });

  const first = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1"), first);
  clock += 2000;
  const cached = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1"), cached);
  assert.deepEqual(JSON.parse(cached.body).steps, JSON.parse(first.body).steps);
  assert.deepEqual(calls, ["one/t1"]);

  clock += 4000;
  const expired = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t1"), expired);
  assert.deepEqual(calls, ["one/t1", "one/t1"]);
  assert.equal(JSON.parse(expired.body).steps[0].id, "s2");

  const otherWorker = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=t2"), otherWorker);
  assert.deepEqual(calls, ["one/t1", "one/t1", "one/t2"]);
});

test("/api/steps rejects an unknown project or worker with 404", async () => {
  const file = stepsConfig();
  const calls = [];
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    now: () => new Date("2026-10-05T12:00:00Z"),
    buildWorkerSteps: async (config, options) => {
      calls.push(options.worker);
      return options.worker === "ok" ? { steps: [] } : null;
    }
  });

  const unknownProject = mockResponse();
  await handler(request("GET", "/api/steps?project=nope&worker=ok"), unknownProject);
  assert.equal(unknownProject.status, 404);
  assert.deepEqual(JSON.parse(unknownProject.body), { error: "unknown project" });
  assert.deepEqual(calls, [], "an unknown project never computes steps");

  const unknownWorker = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=nope"), unknownWorker);
  assert.equal(unknownWorker.status, 404);
  assert.deepEqual(JSON.parse(unknownWorker.body), { error: "unknown worker" });
});

test("/api/steps reports an engine without a step mapper as unsupported", async () => {
  const file = stepsConfig();
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    buildWorkerSteps: async () => ({ steps: [], unsupported: true })
  });

  const response = mockResponse();
  await handler(request("GET", "/api/steps?project=one&worker=codex"), response);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { project: "one", worker: "codex", steps: [], unsupported: true });
});

test("/api/state answers the cached snapshot at once and overlapping requests share one build", async () => {
  const file = tempConfig({ orchestrator: { model: "one" } });
  let builds = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const handler = createRequestHandler({ __file: file }, {
    serverDir: path.dirname(file),
    configPath: file,
    snapshotFreshMs: 60000,
    buildSnapshot: async () => {
      builds += 1;
      await gate;
      return { notices: [], generatedAt: `build-${builds}` };
    }
  });

  const first = mockResponse();
  const second = mockResponse();
  const both = Promise.all([handler(request("GET", "/api/state"), first), handler(request("GET", "/api/state"), second)]);
  release();
  await both;
  assert.equal(builds, 1);
  assert.equal(JSON.parse(first.body).generatedAt, "build-1");
  assert.equal(JSON.parse(second.body).generatedAt, "build-1");

  const third = mockResponse();
  await handler(request("GET", "/api/state"), third);
  assert.equal(builds, 1);
  assert.equal(JSON.parse(third.body).generatedAt, "build-1");
});
