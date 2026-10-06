// Safe file access for the monitor's file endpoints. Everything here is about
// one question: may this request touch this path? A path is served only when
// its real location (symlinks and junctions followed) sits inside the real
// folder of the worker that was asked about. Node built-ins only.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WINDOWS = process.platform === "win32";

export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_PATH_LENGTH = 4096;
export const MAX_BODY_BYTES = 4096;
export const TREE_LIMIT = 5000;
export const TREE_CACHE_MS = 10000;

// The only extensions /api/file will ever send, each with a fixed type. The
// type never comes from the file, so a renamed script cannot pose as an image.
export const FILE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf"
};

// Sent with every file body. `sandbox` gives an SVG or PDF opened on its own
// an opaque origin, so it can never run script against the monitor's origin.
export const FILE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  "Content-Disposition": "inline"
};

// image | video | audio | pdf | other, decided by extension only.
export function kindOf(file) {
  const type = FILE_TYPES[path.extname(String(file)).toLowerCase()] ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  return "other";
}

// True when `target` is `root` or sits below it. The root gets a trailing
// separator before the prefix test so `C:\a\b` never matches `C:\a\bc`, and
// the comparison ignores case on Windows. Both paths must already be real.
export function isInside(root, target) {
  const fold = (value) => (WINDOWS ? String(value).toLowerCase() : String(value));
  const base = fold(root);
  const candidate = fold(target);
  if (candidate === base) return true;
  return candidate.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

function refuse(status, error) {
  return { ok: false, status, error };
}

// Resolves the `path` a client asked for against the worker's folder and
// accepts it only when its real location stays inside that folder's real
// location. Returns { ok: true, root, real } or { ok: false, status, error }.
// Nothing here ever reads file content.
export function resolveContained(workdir, requested) {
  if (typeof requested !== "string" || requested === "" || requested.length > MAX_PATH_LENGTH) {
    return refuse(400, "invalid path");
  }
  if (requested.includes("\0")) return refuse(400, "invalid path");
  // UNC, `\\?\` and `\\.\` forms: checked before any filesystem call, because
  // merely resolving a UNC path would reach out to a remote server.
  if (/^[\\/]{2}/.test(requested)) return refuse(403, "path outside the worker folder");
  if (WINDOWS) {
    // `C:file` is relative to the per-drive current directory, and a colon
    // anywhere else names an NTFS alternate data stream.
    if (/^[a-zA-Z]:(?![\\/])/.test(requested)) return refuse(400, "invalid path");
    if (requested.replace(/^[a-zA-Z]:/, "").includes(":")) return refuse(400, "invalid path");
  }

  let root;
  try {
    root = fs.realpathSync(workdir);
  } catch {
    return refuse(404, "worker folder not found");
  }
  const candidate = path.resolve(root, requested);

  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      // A missing path must answer the same whether or not its real location
      // would have been inside, or the status code reveals what exists outside.
      const ancestor = nearestExistingReal(candidate);
      if (ancestor ? !isInside(root, ancestor) : !isInside(root, candidate)) {
        return refuse(403, "path outside the worker folder");
      }
      return refuse(404, "file not found");
    }
    return refuse(403, "path not accessible");
  }
  if (!isInside(root, real)) return refuse(403, "path outside the worker folder");
  return { ok: true, root, real };
}

function nearestExistingReal(candidate) {
  let current = candidate;
  for (let depth = 0; depth < 256; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
    try {
      return fs.realpathSync(current);
    } catch {
      // Keep climbing until something exists.
    }
  }
  return null;
}

// Parses a single `Range: bytes=a-b` header against a known size. Returns
// { type: "none" } without a header, { type: "range", start, end } (inclusive,
// end clamped) or { type: "invalid" } for anything unsatisfiable or malformed,
// multi-range included.
export function parseRange(header, size) {
  if (header === undefined || header === null || header === "") return { type: "none" };
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/i.exec(String(header).trim());
  if (!match) return { type: "invalid" };
  const [, first, last] = match;
  if (first === "" && last === "") return { type: "invalid" };
  if (first === "") {
    const count = Number(last);
    if (count === 0 || size === 0) return { type: "invalid" };
    return { type: "range", start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return { type: "invalid" };
  if (last === "") return { type: "range", start, end: size - 1 };
  const end = Number(last);
  if (end < start) return { type: "invalid" };
  return { type: "range", start, end: Math.min(end, size - 1) };
}

// Names git or a hand-made index could hold that must never be probed on disk.
function isSafeRelative(name) {
  if (!name || path.isAbsolute(name) || /^[\\/]/.test(name)) return false;
  if (WINDOWS && name.includes(":")) return false;
  return !name.split(/[\\/]/).some((segment) => segment === "..");
}

// Files git tracks or would add, honoring .gitignore. Null when the folder is
// not a usable repository so the caller can walk the directory instead. The
// fsmonitor hook is switched off because a repository an agent can write to
// could otherwise point it at a program git would then run.
async function gitFiles(root, run, timeoutMs) {
  try {
    const { stdout } = await run(
      "git",
      ["-c", "core.fsmonitor=false", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
      }
    );
    return String(stdout).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function walkTree(root, limit) {
  const files = [];
  let truncated = false;
  // Returns false once the cap is hit so every level stops walking.
  const visit = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      // Links and junctions are never followed, so the walk cannot leave the root.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        if (!visit(path.join(dir, entry.name), `${prefix}${entry.name}/`)) return false;
      } else if (entry.isFile()) {
        if (files.length >= limit) {
          truncated = true;
          return false;
        }
        files.push(`${prefix}${entry.name}`);
      }
    }
    return true;
  };
  visit(root, "");
  return { files, truncated };
}

// The files of one worker folder as forward-slash relative paths, capped at
// `limit`. Git first (5 s timeout, no shell), a plain walk when that fails.
export async function listTree(root, options = {}) {
  const limit = options.limit ?? TREE_LIMIT;
  const run = options.execFile ?? execFileAsync;
  const tracked = await gitFiles(root, run, options.timeoutMs ?? 5000);
  if (!tracked) return walkTree(root, limit);
  const files = [];
  let truncated = false;
  for (const name of tracked) {
    if (!isSafeRelative(name)) continue;
    // The index can still list a deleted file or a submodule folder.
    try {
      if (fs.lstatSync(path.join(root, name)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (files.length >= limit) {
      truncated = true;
      break;
    }
    files.push(name.replace(/\\/g, "/"));
  }
  return { files, truncated };
}

// Arguments Explorer receives: a file is selected inside its folder, a folder
// is opened. The path is always an absolute real path, so it can never read as
// a switch.
export function explorerArguments(realPath, isDirectory) {
  return isDirectory ? [realPath] : [`/select,${realPath}`];
}

// Starts Explorer with an argument array: no shell, no command string.
export function spawnExplorer(args, spawnImpl = spawn) {
  const child = spawnImpl("explorer.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false
  });
  child.on?.("error", () => {});
  child.unref();
}
