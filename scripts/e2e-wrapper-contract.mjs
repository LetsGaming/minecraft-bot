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
 * Usage:
 *   npm run build                         # both repos build first
 *   WRAPPER_DIR=../api-wrapper node scripts/e2e-wrapper-contract.mjs
 */
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER_DIR = path.resolve(process.env.WRAPPER_DIR ?? "../api-wrapper");
const API_KEY = "e2e-contract-key-0123456789";
const API_PORT = Number(process.env.E2E_API_PORT ?? 8137);
const RCON_PORT = Number(process.env.E2E_FAKE_RCON_PORT ?? 25599);
const RCON_PASSWORD = "e2e-rcon-password";
const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

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

  const server = net.createServer((socket) => {
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
  return new Promise((resolve) => {
    server.listen(RCON_PORT, "127.0.0.1", () => {
      cleanups.push(() => server.close());
      resolve();
    });
  });
}

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
  fs.writeFileSync(path.join(backupsPath, "hourly", "2026-07-06.tar.zst"), "xxxx");
  // The suite keys mods BY SLUG; the wrapper reads Object.keys(raw.mods).
  // An array here yields slugs ["0","1"] — which is how this fixture was
  // wrong the first time, and why the fixture mirrors the real file.
  fs.writeFileSync(
    path.join(scriptsDir, "common", "downloaded_versions.json"),
    JSON.stringify({
      mods: {
        "fabric-api": { version: "0.100.0" },
        lithium: { version: "0.12.1" },
      },
    }),
  );
  // Capability probes only check for existence.
  for (const rel of ["start.sh", "shutdown.sh", "smart_restart.sh", "backup/backup.sh", "misc/status.sh"]) {
    fs.writeFileSync(path.join(scriptsDir, rel), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
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
        `  Set WRAPPER_DIR to an api-wrapper checkout and run 'npm ci && npm run build' in it.`,
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
await startFakeRcon();
const { logs } = await startWrapper(paths);

const dist = (p) => `file://${path.join(root, "src", ...p)}`;
const serverAccess = await import(dist(["core", "dist", "utils", "server", "serverAccess.js"]));
const { SERVER_SCRIPT_ACTIONS } = await import(dist(["schema", "dist", "serverActions.js"]));
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
  "the wrapper offers nothing this bot is too old to use",
  report.ahead.length === 0 && report.unused.length === 0,
  gaps.join("\n      "),
);

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
check(
  "disk entries carry the four fields the disk alert reads",
  (info?.host?.disks ?? []).every(
    (d) =>
      typeof d.path === "string" &&
      typeof d.usedPercent === "number" &&
      typeof d.availableBytes === "number" &&
      typeof d.totalBytes === "number",
  ),
  JSON.stringify(info?.host?.disks),
);

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
   await serverAccess.listStatsUuids(cfg), [UUID]);

const stats = await serverAccess.readStats(cfg, UUID);
check(
  "readStats returns the parsed stats document",
  stats?.stats?.["minecraft:custom"]?.["minecraft:play_time"] === 12345,
  JSON.stringify(stats),
);

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
check("capabilities carries the non-script flags too", caps.backups === true && caps.modManifest === true, JSON.stringify(caps));

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

const said = await serverAccess.sendCommand(cfg, "say hello");
check("sendCommand returns the console result", typeof said === "string", JSON.stringify(said));

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

cleanup();

if (failures > 0) {
  console.error(`\n✖ ${failures} contract check(s) failed`);
  if (process.env.E2E_DUMP_WRAPPER_LOG) console.error(logs.join(""));
  process.exit(1);
}
console.log("\n✓ bot and wrapper agree on every checked contract");
process.exit(0);
