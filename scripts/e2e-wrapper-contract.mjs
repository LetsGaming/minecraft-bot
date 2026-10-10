#!/usr/bin/env node
/**
 * e2e-wrapper-contract.mjs — runs the bot's OWN serverAccess layer against a
 * REAL api-wrapper process, so cross-repo drift fails here instead of in the
 * field.
 *
 * Why this cannot be a unit test in either repo: the bot's apiGet<T> casts
 * the wrapper's JSON to the caller's type, because the wrapper is a pinned
 * first-party contract rather than arbitrary input. That cast is a promise
 * nothing checks — if the wrapper renames a field, the bot compiles, the
 * wrapper's own tests pass, and a remote instance quietly returns undefined.
 * Only running the two together catches it. Same for the feature manifest and
 * the script-action list: each repo can prove its own half is self-consistent
 * and neither can prove they agree.
 *
 * The wrapper's upstreams are faked, not mocked out: a real RCON responder on
 * a real socket and a scaffolded instance directory. The contract under test
 * is wrapper → bot, so what sits behind the wrapper is irrelevant as long as
 * it makes the wrapper produce a real response.
 *
 * The route list comes from the wrapper's own manifest. Every route in it
 * must be requested by this run (the bot's serverAccess, or a raw request for
 * routes the bot does not call), and a route that is not fails the run unless
 * it is listed in SKIPPED_ROUTES with a reason. A new wrapper route therefore
 * cannot ship without a case here.
 *
 * Script-running routes (scripts/run, the mod mutations, restore) spawn
 * `sudo -n -u <user>`. Where sudo cannot run as the current user (a developer
 * machine without passwordless sudo, Windows), those routes are only checked
 * for their failure shape and reported as unverified; set E2E_REQUIRE_SUDO=1
 * (CI does) to make that a failure instead.
 *
 * Usage:
 *   npm run build                                   # the bot builds first
 *   (cd <wrapper checkout> && npm ci && npm run build)
 *   WRAPPER_DIR=<wrapper checkout> npm run e2e:contract
 */
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.WRAPPER_DIR) {
  console.error(
    "✖ WRAPPER_DIR is not set.\n" +
      "  Point it at a built checkout of the wrapper (mc-api-server):\n" +
      "    WRAPPER_DIR=<path to wrapper> npm run e2e:contract\n" +
      "  Build it first with 'npm ci && npm run build' in that directory.",
  );
  process.exit(1);
}

const dist = (p) => `file://${path.join(root, "src", ...p)}`;

// Hoisted above the scaffold on purpose: the fake suite layout is built FROM
// the shared action list, so an action added there cannot be silently absent
// from the fixture. (The build has already run by the time this script does.)
const { SERVER_SCRIPT_ACTIONS } = await import(dist(["schema", "dist", "serverActions.js"]));

/**
 * The suite filename behind each action — this repo's mirror of the wrapper's
 * SCRIPT_MAP. The bot's contract is the action NAMES; the `.sh` files are the
 * wrapper's business, so the mapping has to be restated here to scaffold a
 * believable layout. Keyed by SERVER_SCRIPT_ACTIONS and checked below, so the
 * restatement cannot quietly fall behind.
 */
const SCRIPT_FILES = {
  start: "start.sh",
  stop: "shutdown.sh",
  restart: "smart_restart.sh",
  rollback: "rollback.sh",
  backup: "backup/backup.sh",
  status: "misc/status.sh",
};

/**
 * Suite artifacts the capability probe looks for that are NOT script actions.
 *
 * `restore.sh` is the case: the wrapper gives restore its own route rather than
 * a scripts/run action, because it needs an absolute path and the argument
 * validator forbids "/". It still has to exist for `capabilities.restore` to
 * come back true.
 */
const EXTRA_SUITE_SCRIPTS = ["backup/restore.sh"];

const unmappedActions = SERVER_SCRIPT_ACTIONS.filter((a) => !SCRIPT_FILES[a]);
if (unmappedActions.length > 0) {
  console.error(
    `✖ e2e scaffold has no script filename for: ${unmappedActions.join(", ")}\n` +
      `  Add it to SCRIPT_FILES in this file (mirror of the wrapper's SCRIPT_MAP).\n` +
      `  Without it the capability probe reports the action false and the\n` +
      `  contract check fails somewhere far away from the actual cause.`,
  );
  process.exit(1);
}

const WRAPPER_DIR = path.resolve(process.env.WRAPPER_DIR);
const API_KEY = "e2e-contract-key-0123456789-abcdefghijklmnop";
const API_PORT = Number(process.env.E2E_API_PORT ?? 8137);
const RCON_PORT = Number(process.env.E2E_FAKE_RCON_PORT ?? 25599);
const RCON_PASSWORD = "e2e-rcon-password";
const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const UUID_PRUNE = "22222222-3333-4444-8555-666666666666";

/**
 * Manifest routes that deliberately have no case, each with the reason. Empty
 * today: every route is exercised. An entry that names a route the wrapper no
 * longer serves fails the run, so this list cannot rot.
 */
const SKIPPED_ROUTES = new Map([]);

const REQUIRE_SUDO = process.env.E2E_REQUIRE_SUDO === "1";

let failures = 0;
const cleanups = [];

// Cleanup must run on every exit path, not just the happy one. An early
// process.exit() that skipped it leaked the wrapper child, which kept the
// port bound — and the next run then adopted that stale process and
// reported its results as its own. A harness that leaks is a harness that
// lies, and this one did.
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of [...cleanups].reverse()) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

function ok(what) {
  console.log(`  ✓ ${what}`);
}
function fail(what, detail) {
  failures++;
  console.error(`  ✖ ${what}\n      ${detail}`);
}
function check(what, cond, detail = "") {
  cond ? ok(what) : fail(what, detail);
}
/** Reported, not counted. For states that are expected rather than wrong. */
function note(what, detail = "") {
  console.log(`  \u001b[33m~\u001b[0m ${what}`);
  if (detail) console.log(`      ${detail}`);
}
function eq(what, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? ok(what) : fail(what, `expected ${e}\n      received  ${a}`);
}

// ── A real RCON server, faked ──────────────────────────────────────────────
// Source RCON: int32 length, int32 id, int32 type, body\0\0.
// type 3 = auth, 2 = exec (and auth response), 0 = response value.
function startFakeRcon() {
  const reply = (id, type, body) => {
    const payload = Buffer.from(body, "utf-8");
    const buf = Buffer.alloc(14 + payload.length);
    buf.writeInt32LE(10 + payload.length, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    payload.copy(buf, 12);
    return buf;
  };

  const answer = (cmd) => {
    if (/^list\b/.test(cmd)) {
      return "There are 2 of a max of 20 players online: Steve, Alex";
    }
    if (/^tps\b/.test(cmd)) return "TPS from last 1m, 5m, 15m: 20.0, 19.9, 19.8";
    return `Unknown command: ${cmd}`;
  };

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (data) => {
      let off = 0;
      while (off + 4 <= data.length) {
        const len = data.readInt32LE(off);
        if (off + 4 + len > data.length) break;
        const id = data.readInt32LE(off + 4);
        const type = data.readInt32LE(off + 8);
        const body = data.toString("utf-8", off + 12, off + 4 + len - 2);
        off += 4 + len;
        if (type === 3) {
          // Auth: echo the id back to accept, -1 to reject.
          socket.write(reply(body === RCON_PASSWORD ? id : -1, 2, ""));
        } else if (type === 2) {
          socket.write(reply(id, 0, answer(body)));
        }
      }
    });
    socket.on("error", () => {});
  });
  const close = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return new Promise((resolve) => {
    server.listen(RCON_PORT, "127.0.0.1", () => {
      cleanups.push(close);
      resolve({ close });
    });
  });
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const BACKUP_ARCHIVES = {
  "2026-07-05.tar.zst": "archive-to-delete",
  "2026-07-06.tar.zst": "xxxx",
  "2026-07-07.tar.zst": "0123456789abcdef".repeat(8),
};
const CONFIG_TEXT = "# example\nenabled = true\nlimit = 10\n";
const INSTALLED_MODS = {
  "fabric-api": { versionId: "v-fabric-api-1", filename: "fabric-api-0.100.0.jar" },
  lithium: { versionId: "v-lithium-1", filename: "lithium-0.12.1.jar" },
};

/**
 * Stand-ins for the suite's update/*.js scripts. The wrapper contracts on the
 * single JSON object each prints with --json (an `ok` boolean, and a `results`
 * array for check-updates) and on the arguments it passes; the stubs print that
 * shape and move jars inside the scaffold the way the real ones do.
 */
const MOD_SCRIPT_STUBS = {
  "_stub.js": String.raw`
const fs = require("fs");
const path = require("path");
const serverDir = path.resolve(__dirname, "..", "..", "server");
const manifestPath = path.resolve(__dirname, "..", "common", "downloaded_versions.json");
const args = process.argv.slice(2).filter((a) => a !== "--json" && a !== "--");
const pos = args.filter((a) => !a.startsWith("--"));
const load = () => JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const save = (d) => fs.writeFileSync(manifestPath, JSON.stringify(d, null, 2));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const opt = (k) => {
  const a = args.find((x) => x.startsWith("--" + k + "="));
  return a ? a.slice(k.length + 3) : undefined;
};
function upgrade(d, slug) {
  const m = d.mods[slug];
  if (!(slug === "lithium" && m.versionId === "v-lithium-1")) return null;
  const next = { versionId: "v-lithium-2", filename: "lithium-0.12.2.jar" };
  const dir = path.join(serverDir, "mods");
  fs.rmSync(path.join(dir, m.filename), { force: true });
  fs.writeFileSync(path.join(dir, next.filename), "jar:" + slug);
  d.mods[slug] = next;
  return { slug, fromVersionId: m.versionId, toVersionId: next.versionId, filename: next.filename };
}
module.exports = { fs, path, serverDir, args, pos, load, save, out, opt, upgrade };
`,
  "add-mod.js": String.raw`
const { fs, path, serverDir, pos, load, save, out, opt } = require("./_stub.js");
const slug = pos[0];
if (slug === "no-such-mod") {
  out({ ok: false, error: "Mod not found on Modrinth", code: "not_found" });
  process.exit(1);
}
const versionId = opt("versionId") || "v-" + slug + "-1";
const filename = slug + "-" + versionId + ".jar";
const d = load();
const existed = Boolean(d.mods[slug]);
d.mods[slug] = { versionId, filename };
save(d);
fs.writeFileSync(path.join(serverDir, "mods", filename), "jar:" + slug);
out({
  ok: true,
  slug,
  projectId: "P-" + slug,
  action: existed ? "filename-updated" : "added",
  versionId,
  filename,
  dependencies: [{ slug: "fabric-api", action: "already-present" }],
});
`,
  "remove-mod.js": String.raw`
const { fs, path, serverDir, pos, load, save, out } = require("./_stub.js");
const slug = pos[0];
const d = load();
const m = d.mods[slug];
if (!m) {
  out({ ok: false, error: "Mod not installed", code: "not_installed" });
  process.exit(1);
}
fs.rmSync(path.join(serverDir, "mods", m.filename), { force: true });
fs.rmSync(path.join(serverDir, "mods", "disabled", m.filename), { force: true });
delete d.mods[slug];
save(d);
out({ ok: true, slug, removedFile: m.filename, orphanedDependencies: [] });
`,
  "check-updates.js": String.raw`
const { load, out, opt } = require("./_stub.js");
const d = load();
const mcVersion = opt("mcVersion") || d.gameVersion;
const only = opt("only");
const result = (slug, m) => {
  if (mcVersion === "1.99" && slug === "lithium") {
    return { slug, status: "no_matching_version", message: "No version matching MC 1.99 in /home/mc/secret-dir" };
  }
  if (mcVersion === "1.99") {
    return { slug, status: "error", error: "connect ETIMEDOUT /var/secret-socket" };
  }
  if (slug === "lithium" && m.versionId === "v-lithium-1") {
    return {
      slug,
      status: "update_available",
      currentVersionId: m.versionId,
      latestVersionId: "v-lithium-2",
      latestVersionName: "Lithium 2",
      datePublished: "2026-01-01T00:00:00Z",
      downloadUrl: "https://cdn.modrinth.com/data/lithium/versions/v-lithium-2/lithium.jar",
    };
  }
  return { slug, status: "up_to_date", currentVersionId: m.versionId };
};
out({
  mcVersion,
  modLoader: d.modLoader,
  results: Object.entries(d.mods)
    .filter(([slug]) => only === undefined || slug === only)
    .map(([slug, m]) => result(slug, m)),
});
`,
  "update-mods.js": String.raw`
const { load, save, out, upgrade } = require("./_stub.js");
const d = load();
const updated = [];
const upToDate = [];
for (const slug of Object.keys(d.mods)) {
  const done = upgrade(d, slug);
  if (done) updated.push(done);
  else upToDate.push(slug);
}
save(d);
out({ ok: true, updated, upToDate, failed: [] });
`,
  "update-mod.js": String.raw`
const { pos, load, save, out, upgrade } = require("./_stub.js");
const slug = pos[0];
const d = load();
if (!d.mods[slug]) {
  out({ ok: false, error: "Mod not installed", code: "not_installed" });
  process.exit(1);
}
const done = upgrade(d, slug);
save(d);
out({ ok: true, updated: done ? [done] : [], upToDate: done ? [] : [slug], failed: [] });
`,
  "toggle-mod.js": String.raw`
const { fs, path, serverDir, args, pos, load, out } = require("./_stub.js");
const slug = pos[0];
const m = load().mods[slug];
if (!m) {
  out({ ok: false, error: "Mod not installed", code: "not_installed" });
  process.exit(1);
}
const active = path.join(serverDir, "mods", m.filename);
const parked = path.join(serverDir, "mods", "disabled", m.filename);
if (args.includes("--disable")) {
  if (!fs.existsSync(active)) {
    out({ ok: true, slug, filename: m.filename, alreadyDisabled: true });
  } else {
    fs.mkdirSync(path.dirname(parked), { recursive: true });
    fs.renameSync(active, parked);
    out({ ok: true, slug, filename: m.filename });
  }
} else if (!fs.existsSync(parked)) {
  out({ ok: true, slug, filename: m.filename, alreadyEnabled: true });
} else {
  fs.renameSync(parked, active);
  out({ ok: true, slug, filename: m.filename });
}
`,
};

/** Where the shell stubs append one line per run; forward slashes so bash accepts it on any host. */
const ranLogPath = (scriptsDir) => path.join(scriptsDir, "ran.log").replace(/\\/g, "/");

// ── A scaffolded instance the wrapper can read ─────────────────────────────
function scaffold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-contract-"));
  const serverPath = path.join(dir, "server");
  const scriptsDir = path.join(dir, "scripts");
  const backupsPath = path.join(dir, "backups");

  fs.mkdirSync(path.join(serverPath, "logs"), { recursive: true });
  // Deliberately the MODDED layout: <level>/players/stats, with no
  // <level>/stats. This scaffold used the vanilla path, which is why it
  // sailed past a real Fabric instance where every stat read 404'd. Both
  // sides must resolve the directory rather than assume it — and the
  // non-default layout is the one worth wiring end to end.
  fs.mkdirSync(path.join(serverPath, "world", "players", "stats"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(serverPath, "world", "players", "advancements"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(backupsPath, "hourly"), { recursive: true });
  fs.mkdirSync(path.join(scriptsDir, "common"), { recursive: true });
  fs.mkdirSync(path.join(scriptsDir, "backup"), { recursive: true });
  fs.mkdirSync(path.join(scriptsDir, "misc"), { recursive: true });

  fs.writeFileSync(path.join(serverPath, "server.properties"), "level-name=world\n");
  fs.writeFileSync(
    path.join(serverPath, "whitelist.json"),
    JSON.stringify([{ name: "Steve", uuid: UUID }]),
  );
  fs.writeFileSync(
    path.join(serverPath, "usercache.json"),
    JSON.stringify([{ name: "Alex", uuid: "11111111-2222-3333-4444-555555555555", expiresOn: "x" }]),
  );
  fs.writeFileSync(
    path.join(serverPath, "world", "players", "stats", `${UUID}.json`),
    JSON.stringify({ stats: { "minecraft:custom": { "minecraft:play_time": 12345 } } }),
  );
  fs.writeFileSync(path.join(serverPath, "logs", "latest.log"), "line one\nline two\n");
  fs.writeFileSync(
    path.join(serverPath, "world", "players", "stats", `${UUID_PRUNE}.json`),
    JSON.stringify({ stats: {} }),
  );
  for (const [name, body] of Object.entries(BACKUP_ARCHIVES)) {
    fs.writeFileSync(path.join(backupsPath, "hourly", name), body);
  }
  fs.mkdirSync(path.join(serverPath, "config"), { recursive: true });
  fs.writeFileSync(path.join(serverPath, "config", "example-mod.toml"), CONFIG_TEXT);
  fs.mkdirSync(path.join(serverPath, "config", "xaero", "minimap", "profiles", "a"), { recursive: true });
  fs.writeFileSync(path.join(serverPath, "config", "xaero", "minimap", "profiles", "a", "xaerominimap.txt"), "minimap:true\nzoom:2\n");
  // The suite keys mods BY SLUG; the wrapper reads Object.keys(raw.mods).
  // An array here yields slugs ["0","1"] — which is how this fixture was
  // wrong the first time, and why the fixture mirrors the real file.
  fs.mkdirSync(path.join(serverPath, "mods"), { recursive: true });
  const installed = {};
  for (const [slug, { versionId, filename }] of Object.entries(INSTALLED_MODS)) {
    installed[slug] = { versionId, filename };
    fs.writeFileSync(path.join(serverPath, "mods", filename), `jar:${slug}`);
  }
  fs.writeFileSync(
    path.join(scriptsDir, "common", "downloaded_versions.json"),
    JSON.stringify({ gameVersion: "1.21.4", modLoader: "fabric", mods: installed }, null, 2),
  );
  // Stub suite scripts. The wrapper only contracts on their names and on the
  // JSON the mod scripts print; each stub prints its own name and arguments so
  // a case can see what the wrapper actually passed.
  for (const rel of [
    ...SERVER_SCRIPT_ACTIONS.map((a) => SCRIPT_FILES[a]),
    ...EXTRA_SUITE_SCRIPTS,
  ]) {
    fs.mkdirSync(path.dirname(path.join(scriptsDir, rel)), { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, rel),
      `#!/bin/sh\necho "${rel} $*" >> "${ranLogPath(scriptsDir)}"\necho "stub:${rel} $*"\nexit 0\n`,
      { mode: 0o755 },
    );
  }
  fs.mkdirSync(path.join(scriptsDir, "update"), { recursive: true });
  for (const [rel, source] of Object.entries(MOD_SCRIPT_STUBS)) {
    fs.writeFileSync(path.join(scriptsDir, "update", rel), source);
  }
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, serverPath, scriptsDir, backupsPath };
}

// ── Boot the real wrapper ──────────────────────────────────────────────────
/** Never adopt a wrapper we did not start — see cleanup() above. */
async function assertPortFree() {
  try {
    await fetch(`http://127.0.0.1:${API_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    return; // nothing listening, which is what we want
  }
  console.error(
    `\u2716 something is already serving 127.0.0.1:${API_PORT}.\n` +
      `  This check starts its own wrapper; adopting a stray one — a leaked\n` +
      `  child from an earlier run, say — would silently test the wrong build.\n` +
      `  Kill it, or set E2E_API_PORT.`,
  );
  process.exit(1);
}

async function startWrapper(paths) {
  const entry = path.join(WRAPPER_DIR, "dist", "index.js");
  if (!fs.existsSync(entry)) {
    console.error(
      `✖ no built wrapper at ${entry}\n` +
        `  WRAPPER_DIR must be a wrapper checkout; run 'npm ci && npm run build' in it.`,
    );
    process.exit(1);
  }

  const configPath = path.join(paths.dir, "api-server-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: API_PORT,
      apiKey: API_KEY,
      instances: {
        smp: {
          serverPath: paths.serverPath,
          scriptsDir: paths.scriptsDir,
          backupsPath: paths.backupsPath,
          linuxUser: os.userInfo().username,
          useRcon: true,
          rconHost: "127.0.0.1",
          rconPort: RCON_PORT,
          rconPassword: RCON_PASSWORD,
        },
        // No RCON channel and a user sudo cannot resolve: a command can only
        // go through the screen fallback, which cannot succeed here.
        mute: {
          serverPath: paths.serverPath,
          scriptsDir: paths.scriptsDir,
          backupsPath: paths.backupsPath,
          linuxUser: "mcbot-e2e-no-such-user",
          useRcon: false,
          rconHost: "127.0.0.1",
          rconPort: RCON_PORT,
          rconPassword: "",
        },
      },
    }),
  );

  const child = spawn(process.execPath, [entry], {
    cwd: WRAPPER_DIR,
    env: {
      ...process.env,
      CONFIG_FILE: configPath,
      MC_API_KEY: API_KEY,
      MC_PORT: String(API_PORT),
      MC_BIND_HOST: "127.0.0.1",
      // Lets the fetch wrapper below give every request its own client
      // address; see there.
      MC_TRUST_PROXY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  cleanups.push(() => child.kill("SIGKILL"));

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
      if (res.ok) return { child, logs };
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`✖ wrapper did not become healthy\n${logs.join("")}`);
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────
await assertPortFree();
const paths = scaffold();
const fakeRcon = await startFakeRcon();
const { logs } = await startWrapper(paths);

// Every request this run makes, so coverage is measured from traffic rather
// than from what a case claims to cover.
//
// Each request also claims its own client address (the wrapper runs with
// MC_TRUST_PROXY). The wrapper budgets mutating requests per client at a few
// per minute, and one run makes dozens; the limiter has its own tests in the
// wrapper, so here it is kept out of the way rather than paced around.
const requested = [];
const realFetch = globalThis.fetch;
let nextClient = 1;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-forwarded-for", `10.77.${(nextClient >> 8) & 255}.${nextClient++ & 255}`);
  const res = await realFetch(input, { ...init, headers });
  requested.push({ method, pathname: url.pathname, status: res.status });
  return res;
};

/** The user the wrapper will `sudo -u` to; whether that works decides what script routes can prove. */
const sudoUser = os.userInfo().username;
const sudoWorks = spawnSync("sudo", ["-n", "-u", sudoUser, "true"], { timeout: 5000 }).status === 0;
/** Routes that were reached but whose script-running path could not execute here. */
const unverified = [];

const serverAccess = await import(dist(["core", "dist", "utils", "server", "serverAccess.js"]));
const { EXPECTED_WRAPPER_FEATURES, compareContract, describeContract } = await import(
  dist(["core", "dist", "utils", "server", "wrapperContract.js"])
);

/** A ServerConfig in remote mode — apiUrl set is what routes calls to HTTP. */
const cfg = {
  id: "smp",
  apiUrl: `http://127.0.0.1:${API_PORT}`,
  apiKey: API_KEY,
  serverDir: paths.serverPath,
  scriptDir: paths.scriptsDir,
  screenSession: "smp",
  linuxUser: os.userInfo().username,
  useRcon: true,
};

console.log("\n── the manifest, read by the bot's own parser");
const manifest = await serverAccess.getRemoteManifest(cfg);
if (!manifest) {
  // getRemoteManifest swallows the reason (404 vs unreachable vs malformed),
  // because at runtime the bot only needs "fall back to the version compare".
  // Here the reason is the whole answer, so ask again directly.
  const res = await fetch(`http://127.0.0.1:${API_PORT}/manifest`, {
    headers: { "x-api-key": API_KEY },
  }).catch((err) => err);
  const detail =
    res instanceof Error
      ? `the request failed: ${res.message}`
      : res.status === 404
        ? `it has no /manifest route — this wrapper predates the feature manifest. ` +
          `Land the wrapper's half first; the bot degrades to the version ` +
          `compare at runtime, but this check has nothing to compare.`
        : `it answered ${res.status} ${res.statusText}, or a body this bot ` +
          `cannot parse. Body: ${await res.text().catch(() => "(unreadable)")}`;
  fail("bot parses the wrapper's manifest", detail);
  console.error(`\n✖ 1 contract check failed`);
  process.exit(1);
}
ok(`wrapper ${manifest.wrapper}, manifest v${manifest.manifest}, ${manifest.routes.length} routes`);

const report = compareContract(manifest);
const gaps = describeContract(manifest, report, "e2e");
check(
  "every feature the bot expects is provided, at the version it expects",
  report.missing.length === 0 && report.outdated.length === 0,
  gaps.join("\n      "),
);
check(
  "no feature the bot reads has moved to a contract version it does not implement",
  report.ahead.length === 0,
  gaps.join("\n      "),
);
// Deliberately not a failure. A wrapper serving features the bot has never
// heard of is the normal state between an additive wrapper release and the bot
// half that consumes it — and that order is the one the workflows tell you to
// use. Nothing calls those routes, so nothing can break. Failing here would
// mean every wrapper feature must land in lockstep with its bot side, in two
// separate repositories, which is not a thing anyone can do.
if (report.unused.length > 0) {
  note(
    "the wrapper offers features this bot does not use yet (expected, not a failure)",
    report.unused.map((f) => f.name).join(", "),
  );
} else {
  ok("the wrapper offers nothing this bot is unaware of");
}

console.log("\n── the script-action contract");
eq(
  "bot SERVER_SCRIPT_ACTIONS == wrapper scriptActions",
  [...SERVER_SCRIPT_ACTIONS].sort(),
  [...manifest.scriptActions].sort(),
);

console.log("\n── every expected feature's routes are really served");
{
  const served = new Set(manifest.routes);
  const missing = Object.keys(EXPECTED_WRAPPER_FEATURES).filter(
    (name) => !Object.keys(manifest.features).includes(name),
  );
  check("no expected feature is absent from the manifest", missing.length === 0, missing.join(", "));
  check(
    "the manifest's routes include the instance surface the bot calls",
    ["GET /instances/:id/info", "GET /instances/:id/usercache", "GET /instances/:id/capabilities"].every(
      (r) => served.has(r),
    ),
    [...served].join(", "),
  );
}

// The point of the rest: these all go through apiGet<T>'s cast. A renamed
// field on the wrapper shows up here as undefined, and nowhere else.
console.log("\n── response shapes, via the bot's real serverAccess");

const info = await serverAccess.getRemoteInfo(cfg);
check("getRemoteInfo returns a version", typeof info?.version === "string", JSON.stringify(info));
check(
  "host metrics arrive in the shape RemoteHostInfo declares",
  info?.host !== undefined && Array.isArray(info.host.disks),
  JSON.stringify(info?.host),
);
// host-info v2. The bot still reads v1 (hostResources.normaliseDisk lifts it),
// but this repo pair is built together, so the wrapper under test must be
// current — accepting v1 here would let a stale wrapper pass as fresh.
// The wrapper reads /proc for this block and reports null elsewhere.
if (process.platform === "linux") {
  check(
    "the whole-machine block is present and plausible",
    typeof info?.host?.host?.cpuPercent === "number" &&
      info.host.host.cpuPercent >= 0 &&
      info.host.host.cpuPercent <= 100 &&
      typeof info.host.host.memTotalBytes === "number" &&
      info.host.host.memUsedBytes > 0 &&
      info.host.host.memUsedBytes <= info.host.host.memTotalBytes &&
      info.host.host.cpuCount >= 1,
    JSON.stringify(info?.host?.host),
  );
} else {
  eq("the whole-machine block is null off Linux, where /proc does not exist", info?.host?.host, null);
}
check(
  "disk entries carry the directory size and the filesystem it sits on",
  (info?.host?.disks ?? []).length > 0 &&
    (info?.host?.disks ?? []).every(
      (d) =>
        typeof d.path === "string" &&
        (d.sizeBytes === null || typeof d.sizeBytes === "number") &&
        typeof d.filesystem?.mountPoint === "string" &&
        typeof d.filesystem.usedPercent === "number" &&
        typeof d.filesystem.availableBytes === "number" &&
        typeof d.filesystem.totalBytes === "number",
    ),
  JSON.stringify(info?.host?.disks),
);
// The bug this shape exists to fix: the scaffold puts the server dir and the
// backups dir on one filesystem with different contents. Identical sizes
// would mean du was not consulted and df is being reported per directory
// again, which is what made two directories look like two disks.
{
  const dirs = info?.host?.disks ?? [];
  const sizes = dirs.map((d) => d.sizeBytes);
  check(
    "two directories on one filesystem report their own sizes, not the filesystem's",
    dirs.length >= 2 &&
      new Set(dirs.map((d) => d.filesystem.mountPoint)).size === 1 &&
      new Set(sizes).size === sizes.length,
    JSON.stringify(sizes),
  );
}

eq("readWhitelist", await serverAccess.readWhitelist(cfg), [{ name: "Steve", uuid: UUID }]);
eq("readUserCache", await serverAccess.readUserCache(cfg), [
  { name: "Alex", uuid: "11111111-2222-3333-4444-555555555555" },
]);
eq("readLevelName", await serverAccess.readLevelName(cfg), "world");
check(
  "isRunning returns a boolean (true here — the wrapper probes RCON and the fake answers)",
  typeof (await serverAccess.isRunning(cfg)) === "boolean",
  "not a boolean",
);
// The scaffold puts these at <level>/players/stats — reverting either
// repo's resolver to the hardcoded <level>/stats fails right here.
eq("listStatsUuids (modded <level>/players/stats layout)",
   [...(await serverAccess.listStatsUuids(cfg))].sort(), [UUID, UUID_PRUNE].sort());

const stats = await serverAccess.readStats(cfg, UUID);
check(
  "readStats returns the parsed stats document",
  stats?.stats?.["minecraft:custom"]?.["minecraft:play_time"] === 12345,
  JSON.stringify(stats),
);

// The gap that let a production bug through: this only ever asked for a UUID
// that exists. A player who has never played is the common case — the wrapper
// answers 404, and readStats used to let that throw, so /stats reported
// "Failed to retrieve stats" (and logged an ERROR) for a player it should
// have said "Stats File Not Found" about. A wrong answer that looks like a
// broken bot is exactly what this seam exists to catch.
try {
  const missing = await serverAccess.readStats(
    cfg,
    "00000000-0000-4000-8000-000000000000",
  );
  eq("readStats returns null for a player with no stats file", missing, null);
} catch (err) {
  // Throwing *is* the regression, so catch it and report it as a failed
  // check rather than letting it take the whole run down as a stack trace.
  fail(
    "readStats returns null for a player with no stats file",
    `it threw instead: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const caps = await serverAccess.detectCapabilities(cfg);
eq(
  "detectCapabilities.scripts matches ScriptCapabilities exactly",
  Object.keys(caps.scripts ?? {}).sort(),
  [...SERVER_SCRIPT_ACTIONS].sort(),
);
check(
  "capability flags are booleans and the scaffolded scripts were found",
  Object.values(caps.scripts).every((v) => v === true),
  JSON.stringify(caps),
);
check(
  "capabilities carries the non-script flags too",
  caps.backups === true && caps.modManifest === true && caps.restore === true,
  JSON.stringify(caps),
);

const mods = await serverAccess.readModSlugs(cfg);
check(
  "readModSlugs returns slugs + mtime",
  Array.isArray(mods?.slugs) && mods.slugs.includes("fabric-api") && typeof mods.mtimeMs === "number",
  JSON.stringify(mods),
);

const backups = await serverAccess.readBackups(cfg);
check(
  "readBackupInfo returns tier dirs and a total",
  Array.isArray(backups?.dirs) && typeof backups.totalBytes === "number",
  JSON.stringify(backups),
);

const tail = await serverAccess.tailLog(cfg, 5);
check("tailLog returns the log text", typeof tail === "string" && tail.includes("line two"), JSON.stringify(tail));

console.log("\n── RCON-backed shapes (fake RCON upstream, real wrapper parse)");
const list = await serverAccess.getList(cfg);
eq("getList", list, { playerCount: "2", maxPlayers: "20", players: ["Steve", "Alex"] });

const tps = await serverAccess.getTps(cfg);
check("getTps returns a parsed TpsResult", tps !== null && typeof tps === "object", JSON.stringify(tps));

console.log("\n── command outcomes (delivered, sent, unreachable)");
{
  const delivered = await serverAccess.sendCommandOutcome(cfg, "list");
  check(
    "an RCON-answered command is { kind: delivered, output }",
    delivered.kind === "delivered" && typeof delivered.output === "string" && delivered.output.includes("players online"),
    JSON.stringify(delivered),
  );
  const muteCfg = { ...cfg, id: "mute", useRcon: false };
  const mute = await serverAccess.sendCommandOutcome(muteCfg, "say hello");
  check(
    "a command neither channel can deliver is { kind: unreachable, reason: screen-failed }",
    mute.kind === "unreachable" && mute.reason === "screen-failed",
    JSON.stringify(mute),
  );
  const down = await serverAccess.sendCommandOutcome({ ...cfg, id: "down", apiUrl: "http://127.0.0.1:9" }, "say hello");
  check(
    "a wrapper that cannot be contacted is { kind: unreachable, reason: wrapper-down }",
    down.kind === "unreachable" && down.reason === "wrapper-down",
    JSON.stringify(down),
  );
  note(
    "the sent outcome needs a live screen session",
    "unit-tested against the wire shape in tests/server/commandOutcome.test.ts and in the wrapper's own route test; not reproducible without screen",
  );
}

console.log("\n── the SSE stream the log watchers depend on");
{
  const url = serverAccess.logStreamUrl(cfg);
  const res = await fetch(url, { headers: { "x-api-key": API_KEY } });
  check("logs/stream accepts the bot's key and streams", res.ok, `status ${res.status}`);
  check(
    "logs/stream is an event stream",
    (res.headers.get("content-type") ?? "").includes("text/event-stream"),
    res.headers.get("content-type") ?? "(none)",
  );
  await res.body?.cancel();
}

// ── Everything below exercises routes the first half does not reach ─────────
// Raw requests are used where the bot has no caller (the route is served for
// the dashboard or for operators) or where the case is about the wrapper's own
// error shape rather than what the bot makes of it.

const base = `http://127.0.0.1:${API_PORT}`;
const inst = (rest) => `/instances/smp${rest}`;

async function raw(method, urlPath, { body, headers, key = true } = {}) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      ...(key ? { "x-api-key": API_KEY } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const isErrorBody = (r) => typeof r.json?.error === "string" && Object.keys(r.json).length === 1;

/** The failure answer for a script route on a host where the script cannot run. */
function expectUnrunnable(what, routeKey, r) {
  unverified.push(routeKey);
  // A script that could not run is either a refused spawn (500 { error }) or a
  // sudo that ran and failed, which the wrapper reports as data: 200 with the
  // non-zero exit code and sudo's stderr.
  const failedScript =
    r.status === 200 &&
    typeof r.json?.output === "string" &&
    typeof r.json.stderr === "string" &&
    r.json.exitCode !== 0;
  check(
    `${what}: with no usable sudo the wrapper answers 500 { error } or a failed script result, not a hang or a raw trace`,
    (r.status === 500 && isErrorBody(r)) || failedScript,
    `${r.status} ${r.text}`,
  );
}

if (!sudoWorks) {
  const detail =
    `'sudo -n -u ${sudoUser} true' does not succeed here, so routes that run a suite script ` +
    `can only be checked for their failure shape.`;
  if (REQUIRE_SUDO) fail("sudo can run suite scripts as the instance user (E2E_REQUIRE_SUDO=1)", detail);
  else note("sudo unavailable: script-running routes are reported as unverified", detail);
}

console.log("\n── public and meta routes");
{
  const health = await raw("GET", "/health", { key: false });
  check(
    "GET /health is public and reports the wrapper version",
    health.status === 200 && health.json?.ok === true && health.json.version === manifest.wrapper,
    health.text,
  );
  const unauth = await raw("GET", inst("/running"), { key: false });
  check("an instance route without the key is 401 { error }", unauth.status === 401 && isErrorBody(unauth), unauth.text);
  const list = await raw("GET", "/instances");
  eq("GET /instances lists the configured instances", list.json, { instances: [{ id: "smp" }, { id: "mute" }] });
  const unknown = await raw("GET", "/instances/nope/running");
  check("an unknown instance is 404 { error }", unknown.status === 404 && isErrorBody(unknown), unknown.text);
  const metrics = await raw("GET", "/metrics");
  check(
    "GET /metrics carries counters, timings and cache statistics",
    metrics.status === 200 &&
      typeof metrics.json?.uptimeSeconds === "number" &&
      typeof metrics.json.inFlight === "number" &&
      typeof metrics.json.rateLimitRejections === "number" &&
      typeof metrics.json.eventLoopDelayMs?.p95 === "number" &&
      typeof metrics.json.memory?.rss === "number" &&
      typeof metrics.json.routes === "object" &&
      typeof metrics.json.cache === "object",
    metrics.text.slice(0, 300),
  );
}

console.log("\n── health v2");
{
  const h = await raw("GET", inst("/health"));
  check(
    "health reports liveness and RCON as separate facts",
    h.status === 200 &&
      h.json?.state === "online" &&
      h.json.processUp === true &&
      h.json.rcon?.configured === true &&
      h.json.rcon.responsive === true &&
      typeof h.json.probe === "string",
    h.text,
  );
  check(
    "health v2 carries restartCount and unitFailed (0 and false while RCON answers)",
    h.json?.restartCount === 0 && h.json.unitFailed === false,
    h.text,
  );
  check(
    "health carries gamePort, checkedAt and ageMs",
    (h.json?.gamePort === null || typeof h.json?.gamePort === "number") &&
      typeof h.json?.checkedAt === "number" &&
      typeof h.json?.ageMs === "number",
    h.text,
  );
  const parsed = await serverAccess.getHealth(cfg);
  check(
    "the bot's getHealth maps the body, including the v2 fields",
    parsed.state === "online" && parsed.restartCount === 0 && parsed.unitFailed === false,
    JSON.stringify(parsed),
  );
}

console.log("\n── stats: bulk and delete");
{
  const bulk = await serverAccess.readAllStats(cfg);
  check(
    "readAllStats returns every player's stats keyed by uuid",
    bulk?.[UUID]?.stats?.["minecraft:custom"]?.["minecraft:play_time"] === 12345 && UUID_PRUNE in bulk,
    JSON.stringify(bulk),
  );
  eq("deleteStatsFile removes a stats file", await serverAccess.deleteStatsFile(cfg, UUID_PRUNE), true);
  eq("deleteStatsFile reports false for a file that is already gone", await serverAccess.deleteStatsFile(cfg, UUID_PRUNE), false);
  const after = await serverAccess.readAllStats(cfg);
  check("the bulk answer no longer lists the deleted file", after !== null && !(UUID_PRUNE in after), JSON.stringify(after));
  const bad = await raw("GET", inst("/stats/not-a-uuid"));
  check("a malformed uuid is 400 { error }", bad.status === 400 && isErrorBody(bad), bad.text);
}

console.log("\n── scripts/run and /command shapes");
{
  const unknownAction = await raw("POST", inst("/scripts/run"), { body: { action: "format-disk" } });
  check("an unknown script action is 400 { error }", unknownAction.status === 400 && isErrorBody(unknownAction), unknownAction.text);
  const badArgs = await raw("POST", inst("/scripts/run"), { body: { action: "status", args: ["../etc/passwd"] } });
  check("a path in script args is 400 { error }", badArgs.status === 400 && isErrorBody(badArgs), badArgs.text);
  const noAction = await raw("POST", inst("/scripts/run"), { body: {} });
  check("a missing action is 400 { error }", noAction.status === 400 && isErrorBody(noAction), noAction.text);

  if (sudoWorks) {
    const ran = await serverAccess.runScript(cfg, "status", ["a-b"]);
    check(
      "runScript returns { output, stderr, exitCode } from the script",
      typeof ran.stderr === "string" && ran.exitCode === 0 && ran.output === "stub:misc/status.sh a-b",
      JSON.stringify(ran),
    );
  } else {
    expectUnrunnable("POST scripts/run", "POST /instances/:id/scripts/run", await raw("POST", inst("/scripts/run"), { body: { action: "status" } }));
  }

  const empty = await raw("POST", inst("/command"), { body: { command: "  " } });
  check("a blank command is 400 { error }", empty.status === 400 && isErrorBody(empty), empty.text);
  const said = await raw("POST", inst("/command"), { body: { command: "list" } });
  check(
    "a command answered over RCON is { result, via: rcon, sent: true }",
    said.status === 200 && typeof said.json?.result === "string" && said.json.via === "rcon" && said.json.sent === true && !("rconError" in said.json),
    said.text,
  );
  const muted = await raw("POST", "/instances/mute/command", { body: { command: "list" } });
  check("a command that no channel can deliver is 502 { error }, not 200 { result: null }", muted.status === 502 && isErrorBody(muted), muted.text);
}

console.log("\n── backup files: list, download, delete");
const archives = await serverAccess.indexBackupFiles(cfg);
{
  check(
    "the index lists every archive with an opaque id, tier, name and size",
    archives.total === 3 &&
      archives.files.length === 3 &&
      archives.nextCursor === null &&
      archives.files.every(
        (f) => /^[A-Za-z0-9_-]{22}$/.test(f.id) && f.tier === "hourly" && typeof f.name === "string" && typeof f.sizeBytes === "number" && typeof f.mtimeMs === "number",
      ),
    JSON.stringify(archives),
  );
  const first = await serverAccess.indexBackupFiles(cfg, { limit: 2 });
  const second = first.nextCursor
    ? await serverAccess.indexBackupFiles(cfg, { cursor: first.nextCursor, limit: 2 })
    : null;
  check(
    "paging with limit and cursor walks the whole listing once",
    first.files.length === 2 &&
      typeof first.nextCursor === "string" &&
      second?.files.length === 1 &&
      second.nextCursor === null &&
      new Set([...first.files, ...second.files].map((f) => f.id)).size === 3,
    JSON.stringify({ first, second }),
  );

  const big = archives.files.find((f) => f.name === "2026-07-07.tar.zst");
  const whole = await serverAccess.openBackupDownload(cfg, big.id);
  const wholeBody = await whole.text();
  check(
    "download streams the archive with Content-Length and range support",
    whole.status === 200 &&
      wholeBody === BACKUP_ARCHIVES["2026-07-07.tar.zst"] &&
      whole.headers.get("content-length") === String(wholeBody.length) &&
      whole.headers.get("accept-ranges") === "bytes" &&
      (whole.headers.get("content-disposition") ?? "").includes("2026-07-07.tar.zst"),
    `${whole.status} ${JSON.stringify([...whole.headers])}`,
  );
  const part = await serverAccess.openBackupDownload(cfg, big.id, "bytes=0-3");
  check(
    "a Range request is answered 206 with the matching Content-Range",
    part.status === 206 &&
      (await part.text()) === "0123" &&
      part.headers.get("content-range") === `bytes 0-3/${wholeBody.length}`,
    `${part.status} ${part.headers.get("content-range")}`,
  );
  const past = await serverAccess.openBackupDownload(cfg, big.id, "bytes=9999-");
  await past.arrayBuffer();
  check("an unsatisfiable Range is 416", past.status === 416, String(past.status));
  const badId = await raw("GET", inst("/backups/files/short/download"));
  check("a malformed backup id is 400 { error }", badId.status === 400 && isErrorBody(badId), badId.text);
  const noSuch = await raw("GET", inst(`/backups/files/${"A".repeat(22)}/download`));
  check("a well-formed id that names nothing is 404 { error }", noSuch.status === 404 && isErrorBody(noSuch), noSuch.text);

  const victim = archives.files.find((f) => f.name === "2026-07-05.tar.zst");
  const deleted = await serverAccess.deleteBackupFile(cfg, victim.id);
  check(
    "deleteBackupFile reports what it removed",
    deleted.ok === true && deleted.name === victim.name && deleted.tier === "hourly" && deleted.sizeBytes === victim.sizeBytes,
    JSON.stringify(deleted),
  );
  check("the deleted archive is gone from disk and from the index", !fs.existsSync(path.join(paths.backupsPath, "hourly", victim.name)) && (await serverAccess.indexBackupFiles(cfg)).total === 2);
  eq("deleting it again reports ok:false", (await serverAccess.deleteBackupFile(cfg, victim.id)).ok, false);
  const badDelete = await raw("DELETE", inst("/backups/files/short"));
  check("deleting with a malformed id is 400 { error }", badDelete.status === 400 && isErrorBody(badDelete), badDelete.text);
}

console.log("\n── restore: refused while the server is online");
const restoreTarget = archives.files.find((f) => f.name === "2026-07-06.tar.zst");
{
  const refused = await raw("POST", inst(`/backups/files/${restoreTarget.id}/restore`));
  check(
    "restore answers 409 { error, state } while RCON answers",
    refused.status === 409 &&
      typeof refused.json?.error === "string" &&
      refused.json.state === "online" &&
      Object.keys(refused.json).length === 2,
    refused.text,
  );
  let threw = "";
  try {
    await serverAccess.restoreBackupFile(cfg, restoreTarget.id);
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err);
  }
  check("the bot's restoreBackupFile surfaces the refusal instead of reporting success", threw.includes("409"), threw || "it did not throw");
  const noRestore = await raw("POST", inst(`/backups/files/${"A".repeat(22)}/restore`));
  check("restoring an unknown archive is 404 { error }", noRestore.status === 404 && isErrorBody(noRestore), noRestore.text);
  const badRestore = await raw("POST", inst("/backups/files/short/restore"));
  check("restoring with a malformed id is 400 { error }", badRestore.status === 400 && isErrorBody(badRestore), badRestore.text);
  const ranLog = path.join(paths.scriptsDir, "ran.log");
  check(
    "the restore script did not run",
    !fs.existsSync(ranLog) || !fs.readFileSync(ranLog, "utf-8").includes("backup/restore.sh"),
    fs.existsSync(ranLog) ? fs.readFileSync(ranLog, "utf-8") : "",
  );
}

console.log("\n── mod config files: index, read, write, revert");
{
  const { files } = await serverAccess.indexConfigFiles(cfg);
  const file = files.find((f) => f.relPath === "config/example-mod.toml");
  check(
    "the index lists the config with an opaque id, owning mod and format",
    file !== undefined && /^[A-Za-z0-9_-]{22}$/.test(file.id) && file.modId === "example" && file.format === "toml" && file.sizeBytes === CONFIG_TEXT.length,
    JSON.stringify(files),
  );
  const nested = files.find((f) => f.relPath === "config/xaero/minimap/profiles/a/xaerominimap.txt");
  check(
    "a text file five levels down is listed under its mod folder with an editable flag",
    nested !== undefined && nested.modId === "xaero" && nested.format === "text" && nested.editable === true && nested.tooLarge === false,
    JSON.stringify(files),
  );
  eq("a small tree is not truncated", (await serverAccess.indexConfigFiles(cfg)).truncated, false);
  const read = await serverAccess.readConfigFile(cfg, file.id);
  check(
    "reading returns text, etag, file info and snapshots",
    read.text === CONFIG_TEXT && typeof read.etag === "string" && read.file.id === file.id && Array.isArray(read.snapshots) && read.snapshots.length === 0,
    JSON.stringify(read),
  );
  const edited = CONFIG_TEXT.replace("limit = 10", "limit = 20");
  const written = await serverAccess.writeConfigFile(cfg, file.id, edited, read.etag);
  check(
    "writing with the current etag returns a new etag and a snapshot name",
    written.ok === true && written.etag !== read.etag && typeof written.snapshot === "string",
    JSON.stringify(written),
  );
  eq("writing with a stale etag is a conflict, not an overwrite", await serverAccess.writeConfigFile(cfg, file.id, "x = 1\n", read.etag), { ok: false, conflict: true });
  const reread = await serverAccess.readConfigFile(cfg, file.id);
  check(
    "the edit is on disk and the previous content was snapshotted",
    reread.text === edited && reread.etag === written.etag && reread.snapshots.includes(written.snapshot),
    JSON.stringify(reread),
  );
  const big = `# ${"x".repeat(100 * 1024)}
${edited}`;
  const bigWritten = await serverAccess.writeConfigFile(cfg, file.id, big, written.etag);
  check("a 100 KB config saves (per-route body limit)", bigWritten.ok === true, JSON.stringify(bigWritten));
  const tooBig = await serverAccess.writeConfigFile(cfg, file.id, "x".repeat(1024 * 1024 + 1), bigWritten.etag).catch((e) => e);
  check("a text over the cap is a typed too-large error", tooBig?.name === "ConfigAccessError" && tooBig.kind === "too-large", String(tooBig));
  const reverted = await serverAccess.revertConfigFile(cfg, file.id, written.snapshot);
  check("revert returns the etag of the restored content", typeof reverted.etag === "string", JSON.stringify(reverted));
  eq("revert restores the snapshotted text", (await serverAccess.readConfigFile(cfg, file.id)).text, CONFIG_TEXT);

  const noMatch = await raw("PUT", inst(`/configs/${file.id}`), { body: { text: "a = 1\n" } });
  check("a write without If-Match is 428 { error }", noMatch.status === 428 && isErrorBody(noMatch), noMatch.text);
  const badBody = await raw("PUT", inst(`/configs/${file.id}`), { body: { nope: 1 }, headers: { "if-match": "x" } });
  check("a write without text is 400 { error }", badBody.status === 400 && isErrorBody(badBody), badBody.text);
  const unknownConfig = await raw("GET", inst(`/configs/${"A".repeat(22)}`));
  check("an unknown config id is 404 { error }", unknownConfig.status === 404 && isErrorBody(unknownConfig), unknownConfig.text);
  const badConfig = await raw("GET", inst("/configs/short"));
  check("a malformed config id is 400 { error }", badConfig.status === 400 && isErrorBody(badConfig), badConfig.text);
  const badSnapshot = await raw("POST", inst(`/configs/${file.id}/revert`), { body: { snapshot: "nope" } });
  check("reverting to an unknown snapshot is 404 { error }", badSnapshot.status === 404 && isErrorBody(badSnapshot), badSnapshot.text);
  const noSnapshot = await raw("POST", inst(`/configs/${file.id}/revert`), { body: {} });
  check("reverting without a snapshot name is 400 { error }", noSnapshot.status === 400 && isErrorBody(noSnapshot), noSnapshot.text);
}

console.log("\n── mod management");
{
  const installed = await serverAccess.listInstalledMods(cfg);
  check(
    "listInstalledMods returns the game version, loader, and every mod with its jar and enabled state",
    installed.gameVersion === "1.21.4" &&
      installed.modLoader === "fabric" &&
      typeof installed.mtimeMs === "number" &&
      installed.mods.length === 2 &&
      installed.mods.every((m) => typeof m.versionId === "string" && typeof m.filename === "string" && m.enabled === true),
    JSON.stringify(installed),
  );

  const badSlug = await raw("POST", inst("/mods"), { body: { slug: "bad slug!" } });
  check("installing with an invalid slug is 400 { error }", badSlug.status === 400 && isErrorBody(badSlug), badSlug.text);
  const badRemove = await raw("DELETE", inst("/mods/bad!slug"));
  check("removing an invalid slug is 400 { error }", badRemove.status === 400 && isErrorBody(badRemove), badRemove.text);
  const badCheck = await raw("GET", inst("/mods/updates?mcVersion=%20bad"));
  check("checking updates with an invalid mcVersion is 400 { error }", badCheck.status === 400 && isErrorBody(badCheck), badCheck.text);
  const badApply = await raw("POST", inst("/mods/updates"), { body: { mcVersion: "no good" } });
  check("applying updates with an invalid mcVersion is 400 { error }", badApply.status === 400 && isErrorBody(badApply), badApply.text);
  const badUpdate = await raw("POST", inst("/mods/bad!slug/update"));
  check("updating an invalid slug is 400 { error }", badUpdate.status === 400 && isErrorBody(badUpdate), badUpdate.text);
  const badToggle = await raw("POST", inst("/mods/bad!slug/disable"));
  check("disabling an invalid slug is 400 { error }", badToggle.status === 400 && isErrorBody(badToggle), badToggle.text);

  if (sudoWorks) {
    const added = await serverAccess.addMod(cfg, { slug: "sodium", mcVersion: "1.21.4", modLoader: "fabric" });
    check(
      "addMod returns the script's structured result",
      added.ok === true && added.slug === "sodium" && added.action === "added" && added.versionId === "v-sodium-1" && added.filename === "sodium-v-sodium-1.jar" && Array.isArray(added.dependencies),
      JSON.stringify(added),
    );
    const pinned = await serverAccess.addMod(cfg, { slug: "sodium", versionId: "v-sodium-9" });
    check("addMod passes versionId through to the script", pinned.ok === true && pinned.versionId === "v-sodium-9", JSON.stringify(pinned));
    const missing = await serverAccess.addMod(cfg, { slug: "no-such-mod" });
    check("a script's handled failure arrives as { ok: false, error, code } at 200", missing.ok === false && typeof missing.error === "string" && missing.code === "not_found", JSON.stringify(missing));
    check("the installed list reflects the install", (await serverAccess.listInstalledMods(cfg)).mods.some((m) => m.slug === "sodium"));

    const check1 = await serverAccess.checkModUpdates(cfg, "1.21.4");
    check(
      "checkModUpdates returns the version, loader and a status per mod",
      check1.mcVersion === "1.21.4" && check1.modLoader === "fabric" && check1.results.find((r) => r.slug === "lithium")?.status === "update_available",
      JSON.stringify(check1),
    );
    const applied = await serverAccess.applyModUpdates(cfg);
    check(
      "applyModUpdates reports what it updated and what was already current",
      applied.ok === true && applied.updated?.length === 1 && applied.updated[0].slug === "lithium" && applied.updated[0].fromVersionId === "v-lithium-1" && applied.updated[0].toVersionId === "v-lithium-2" && Array.isArray(applied.upToDate) && Array.isArray(applied.failed),
      JSON.stringify(applied),
    );
    await serverAccess.addMod(cfg, { slug: "lithium", versionId: "v-lithium-1" });
    const one = await serverAccess.updateMod(cfg, "lithium");
    check("updateMod updates one mod and reports it in the same shape", one.ok === true && one.updated?.length === 1 && one.updated[0].toVersionId === "v-lithium-2", JSON.stringify(one));
    const unknownMod = await serverAccess.updateMod(cfg, "no-such-mod");
    check("updating a mod that is not installed is { ok: false } at 200", unknownMod.ok === false && unknownMod.code === "not_installed", JSON.stringify(unknownMod));

    const off = await serverAccess.disableMod(cfg, "lithium");
    check("disableMod moves the jar aside", off.ok === true && off.slug === "lithium" && typeof off.filename === "string", JSON.stringify(off));
    const afterOff = await serverAccess.listInstalledMods(cfg);
    eq("the installed list marks it disabled", afterOff.mods.find((m) => m.slug === "lithium")?.enabled, false);
    check("the slug-only list leaves the disabled mod out", !(await serverAccess.readModSlugs(cfg)).slugs.includes("lithium"));
    check("disabling twice says so", (await serverAccess.disableMod(cfg, "lithium")).alreadyDisabled === true);
    const on = await serverAccess.enableMod(cfg, "lithium");
    check("enableMod puts the jar back", on.ok === true, JSON.stringify(on));
    eq("the installed list marks it enabled again", (await serverAccess.listInstalledMods(cfg)).mods.find((m) => m.slug === "lithium")?.enabled, true);
    check("enabling twice says so", (await serverAccess.enableMod(cfg, "lithium")).alreadyEnabled === true);

    const removed = await serverAccess.removeMod(cfg, "sodium");
    check("removeMod reports the removed file and orphaned dependencies", removed.ok === true && typeof removed.removedFile === "string" && Array.isArray(removed.orphanedDependencies), JSON.stringify(removed));
    const gone = await serverAccess.removeMod(cfg, "sodium");
    check("removing a mod that is gone is { ok: false } at 200", gone.ok === false && gone.code === "not_installed", JSON.stringify(gone));
  } else {
    const fixed = [
      ["POST", "/mods", { slug: "sodium" }],
      ["DELETE", "/mods/sodium", undefined],
      ["GET", "/mods/updates", undefined],
      ["POST", "/mods/updates", {}],
      ["POST", "/mods/lithium/update", undefined],
      ["POST", "/mods/lithium/disable", undefined],
      ["POST", "/mods/lithium/enable", undefined],
    ];
    for (const [method, rest, body] of fixed) {
      const routeKey = `${method} /instances/:id${rest.replace(/lithium|sodium/, ":slug").replace(/\?.*/, "")}`;
      expectUnrunnable(`${method} ${rest}`, routeKey, await raw(method, inst(rest), { body }));
    }
  }
}

console.log("\n── mod compatibility check");
{
  const JOB_ABSENT = "00000000-0000-4000-8000-000000000000";
  const settle = async (jobId) => {
    for (let i = 0; i < 100; i++) {
      const j = await serverAccess.getModCompat(cfg, jobId);
      if (j === null || j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  };

  const noVersion = await raw("POST", inst("/mods/compat"), { body: {} });
  check("starting without mcVersion is 400 { error }", noVersion.status === 400 && isErrorBody(noVersion), noVersion.text);
  const badVersion = await raw("POST", inst("/mods/compat"), { body: { mcVersion: "no good" } });
  check("starting with an invalid mcVersion is 400 { error }", badVersion.status === 400 && isErrorBody(badVersion), badVersion.text);
  const badJob = await raw("GET", inst("/mods/compat/not-a-job"));
  check("polling a malformed job id is 400 { error }", badJob.status === 400 && isErrorBody(badJob), badJob.text);
  eq("polling a job the wrapper never had is null (404)", await serverAccess.getModCompat(cfg, JOB_ABSENT), null);

  const started = await serverAccess.startModCompat(cfg, "1.99");
  check("starting returns a uuid job id", /^[0-9a-f-]{36}$/.test(started.jobId), JSON.stringify(started));
  const finished = await settle(started.jobId);
  const text = JSON.stringify(finished);
  if (sudoWorks) {
    check(
      "the job ends done with a per-mod availability and summary counts",
      finished?.state === "done" &&
        finished.mcVersion === "1.99" &&
        finished.modLoader === "fabric" &&
        finished.complete === false &&
        finished.summary?.total === 2 &&
        finished.summary.unavailable === 1 &&
        finished.summary.unknown === 1 &&
        finished.mods.find((m) => m.slug === "lithium")?.availability === "unavailable" &&
        finished.mods.find((m) => m.slug === "fabric-api")?.availability === "unknown",
      text,
    );
    check(
      "script text and paths never reach the client (fixed reasons only)",
      !/secret|[/]home|[/]var/.test(text) &&
        finished.mods.find((m) => m.slug === "fabric-api")?.reason === "timeout" &&
        finished.mods.find((m) => m.slug === "lithium")?.reason === "no compatible release",
      text,
    );

    const ready = await settle((await serverAccess.startModCompat(cfg, "1.21.5")).jobId);
    check(
      "a version every mod supports reports them available, with the target release of an update",
      ready?.state === "done" &&
        ready.complete === true &&
        ready.summary?.available === 2 &&
        ready.mods.find((m) => m.slug === "lithium")?.target?.versionName === "Lithium 2" &&
        ready.mods.find((m) => m.slug === "lithium")?.target?.downloadUrl?.startsWith("https://cdn.modrinth.com/") === true,
      JSON.stringify(ready),
    );
    const again = await serverAccess.getModCompat(cfg, (await serverAccess.startModCompat(cfg, "1.21.5")).jobId);
    check("an unchanged repeat is answered from the cache as an already finished job", again?.state === "done" && again.summary?.available === 2, JSON.stringify(again));
  } else {
    check(
      "without sudo every mod fails to check, the job fails, and the reason is a fixed phrase",
      finished?.state === "failed" && finished.error === "script failed" && !/sudo|[/]home|secret/.test(text),
      text,
    );
  }
}

console.log("\n── restore: runs against the scaffold once the server is offline");
{
  fakeRcon.close();
  let state = "";
  for (let i = 0; i < 40 && state !== "offline"; i++) {
    state = (await raw("GET", inst("/health"))).json?.state ?? "";
    if (state !== "offline") await new Promise((r) => setTimeout(r, 500));
  }
  const restoreKey = "POST /instances/:id/backups/files/:fileId/restore";
  if (state !== "offline") {
    unverified.push(restoreKey);
    const detail = `the wrapper still reports '${state}' with the fake RCON closed, so the refusal path is the only one reachable here`;
    if (REQUIRE_SUDO) fail("restore runs once the server reports offline (E2E_REQUIRE_SUDO=1)", detail);
    else note("restore after shutdown is unverified", detail);
  } else if (!sudoWorks) {
    expectUnrunnable("restore", restoreKey, await raw("POST", inst(`/backups/files/${restoreTarget.id}/restore`)));
  } else {
    const result = await serverAccess.restoreBackupFile(cfg, restoreTarget.id);
    check(
      "restore returns the script result once the server is offline",
      result.exitCode === 0 && result.output.startsWith("stub:backup/restore.sh --file ") && result.output.endsWith(" --y"),
      JSON.stringify(result),
    );
    const resolved = result.output.slice("stub:backup/restore.sh --file ".length, -" --y".length);
    check(
      "the path handed to the script is one the wrapper resolved inside the backups directory",
      path.resolve(resolved) === path.join(paths.backupsPath, "hourly", restoreTarget.name),
      resolved,
    );
  }

  const fallback = await raw("POST", inst("/command"), { body: { command: "say bye" } });
  const viaScreen =
    fallback.status === 200 &&
    fallback.json?.result === null &&
    fallback.json.via === "screen" &&
    fallback.json.sent === true &&
    typeof fallback.json.rconError === "string";
  const refused = fallback.status === 502 && isErrorBody(fallback);
  check(
    "a command with RCON down is a screen send naming the RCON error, or 502 { error } when screen cannot deliver it",
    viaScreen || refused,
    fallback.text,
  );
  if (viaScreen) {
    const sent = await serverAccess.sendCommandOutcome(cfg, "say bye");
    check("the bot reads that reply as { kind: sent, via: rcon-fallback }", sent.kind === "sent" && sent.via === "rcon-fallback", JSON.stringify(sent));
  } else {
    const out = await serverAccess.sendCommandOutcome(cfg, "say bye");
    check("the bot reads the refusal as { kind: unreachable, reason: screen-failed }", out.kind === "unreachable" && out.reason === "screen-failed", JSON.stringify(out));
  }
}

console.log("\n── every manifest route was exercised");
{
  const matchers = manifest.routes.map((route) => {
    const [method, pattern] = route.split(" ");
    const parts = pattern.split("/");
    return { route, method, parts, statics: parts.filter((p) => !p.startsWith(":")).length };
  });
  const answered = new Set();
  const succeeded = new Set();
  for (const { method, pathname, status } of requested) {
    const segments = pathname.split("/");
    const best = matchers
      .filter((m) => m.method === method && m.parts.length === segments.length && m.parts.every((p, i) => p.startsWith(":") || p === segments[i]))
      .sort((a, b) => b.statics - a.statics)[0];
    if (!best) continue;
    answered.add(best.route);
    if (status >= 200 && status < 300) succeeded.add(best.route);
  }
  const unverifiedSet = new Set(unverified);

  const stale = [...SKIPPED_ROUTES.keys()].filter((r) => !manifest.routes.includes(r));
  check("SKIPPED_ROUTES names only routes the wrapper still serves", stale.length === 0, stale.join(", "));

  const never = manifest.routes.filter((r) => !answered.has(r) && !SKIPPED_ROUTES.has(r));
  check(
    "every route in the wrapper's manifest is requested (add a case for a new route, or list it in SKIPPED_ROUTES with a reason)",
    never.length === 0,
    never.join("\n      "),
  );
  const noSuccess = manifest.routes.filter(
    (r) => answered.has(r) && !succeeded.has(r) && !unverifiedSet.has(r) && !SKIPPED_ROUTES.has(r),
  );
  check(
    "every requested route also produced a successful answer",
    noSuccess.length === 0,
    noSuccess.join("\n      "),
  );
  if (unverified.length > 0) {
    note(
      `${unverified.length} route(s) were reached but their success path could not run on this host`,
      [...unverifiedSet].join("\n      "),
    );
  }
}

cleanup();

if (failures > 0) {
  console.error(`\n✖ ${failures} contract check(s) failed`);
  if (process.env.E2E_DUMP_WRAPPER_LOG) console.error(logs.join(""));
  process.exit(1);
}
console.log("\n✓ bot and wrapper agree on every checked contract");
process.exit(0);
