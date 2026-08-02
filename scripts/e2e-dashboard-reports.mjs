/**
 * End-to-end check of the four dashboard reports, against a REAL wrapper
 * process serving a REAL instance directory with real backup archives.
 *
 * Not a unit test: no mocks. It starts the built wrapper, points a real
 * dashboard at it, and calls the same routes a browser would.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER_DIR = path.resolve(process.env.WRAPPER_DIR ?? "../api-wrapper");
const API_KEY = "e2e-dashboard-key-0123456789";
const API_PORT = 8142;
const SYSADMIN = "272402865874534400";

let failures = 0;
const cleanups = [];
function ok(name) { console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
function bad(name, detail) {
  failures++;
  console.log(`  \x1b[31m✖\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
}
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

process.env.WEBUI_SESSION_SECRET = "e2e-session-secret-0123456789";
process.env.WEBUI_CLIENT_SECRET = "e2e-client-secret-0123456789";

// ── Scaffold an instance with backups and a log ──────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-dash-"));
cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));

const serverPath = path.join(tmp, "server");
const scriptsDir = path.join(tmp, "scripts");
const backupsPath = path.join(tmp, "backups");
fs.mkdirSync(path.join(serverPath, "logs"), { recursive: true });
fs.mkdirSync(path.join(scriptsDir, "backup"), { recursive: true });
fs.mkdirSync(path.join(scriptsDir, "misc"), { recursive: true });

// The log the console primes from — 150 lines, so the 100-line cap is exercised.
fs.writeFileSync(
  path.join(serverPath, "logs", "latest.log"),
  Array.from({ length: 150 }, (_, i) => `[00:00:${String(i).padStart(2, "0")}] line ${i + 1}`).join("\n") + "\n",
);

// Mod configs, in two of the allow-listed roots.
fs.mkdirSync(path.join(serverPath, "config"), { recursive: true });
fs.writeFileSync(path.join(serverPath, "config", "mymod-common.toml"),
  '[general]\n\t#How many mobs may spawn per chunk.\n\t#Range: 1 ~ 64\n\t#Default: 8\n\tmaxSpawnCount = 8\n\t#Allowed Values: PEACEFUL, EASY, NORMAL, HARD\n\tdifficulty = "NORMAL"\n');
fs.writeFileSync(path.join(serverPath, "server.properties"), "motd=Hello\nmax-players=20\n");
// Must never be reachable: editing it is granting yourself operator.
fs.writeFileSync(path.join(serverPath, "ops.json"), '[{"name":"dom","level":4}]');

for (const rel of ["start.sh", "shutdown.sh", "smart_restart.sh", "rollback.sh",
                   "backup/backup.sh", "backup/restore.sh", "misc/status.sh"]) {
  fs.writeFileSync(path.join(scriptsDir, rel), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

// Distinct mtimes: the index sorts newest-first, and files written in the same
// instant would order arbitrarily and make the assertion flaky.
const now = Date.now();
for (const [tier, name, size, ageHours] of [
  ["hourly", "world-2026-08-02-08.tar.zst", 4096, 1],
  ["hourly", "world-2026-08-02-07.tar.zst", 2048, 2],
  ["archives/daily", "world-2026-08-01.tar.zst", 8192, 26],
]) {
  fs.mkdirSync(path.join(backupsPath, tier), { recursive: true });
  const file = path.join(backupsPath, tier, name);
  fs.writeFileSync(file, Buffer.alloc(size, "a"));
  const t = (now - ageHours * 3_600_000) / 1000;
  fs.utimesSync(file, t, t);
}

// ── Start the real wrapper ───────────────────────────────────────────────────
const wrapperCfg = path.join(tmp, "api-server-config.json");
// The file uses lowercase `port`/`apiKey`; AppConfig's PORT/API_KEY are the
// normalised in-memory names (config/load.ts:87-90).
fs.writeFileSync(wrapperCfg, JSON.stringify({
  port: API_PORT,
  apiKey: API_KEY,
  instances: {
    server: {
      id: "server", serverPath, scriptsDir, backupsPath,
      linuxUser: os.userInfo().username, useRcon: false,
      rconHost: "127.0.0.1", rconPort: 25599, rconPassword: "x",
    },
  },
}, null, 2));

const wrapper = spawn(process.execPath, [path.join(WRAPPER_DIR, "dist/index.js")], {
  env: { ...process.env, CONFIG_FILE: wrapperCfg },
  stdio: ["ignore", "pipe", "pipe"],
});
cleanups.push(() => wrapper.kill("SIGTERM"));
let wrapperLog = "";
wrapper.stdout.on("data", (d) => (wrapperLog += d));
wrapper.stderr.on("data", (d) => (wrapperLog += d));

async function waitForWrapper() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ── Point a real dashboard at it ─────────────────────────────────────────────
const botCfg = path.join(tmp, "config.json");
fs.writeFileSync(botCfg, JSON.stringify({
  token: "x".repeat(59), clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { server: { apiUrl: `http://127.0.0.1:${API_PORT}`, apiKey: API_KEY } },
  guilds: {},
  webui: { enabled: true, publicUrl: "http://localhost:8130" },
}, null, 2));
process.env.MCBOT_CONFIG_PATH = botCfg;

const dist = (p) => `file://${path.join(root, "src", ...p)}`;

async function main() {
  if (!(await waitForWrapper())) {
    bad("wrapper started", wrapperLog.slice(-600));
    return;
  }
  ok("wrapper started and answering /health");

  // The web entrypoint (backend/index.ts:49) builds the instance registry
  // before serving; buildServer() alone does not, so do what it does.
  const { loadConfig } = await import(dist(["core", "dist", "config.js"]));
  const { initServers } = await import(dist(["core", "dist", "utils", "server", "server.js"]));
  initServers(loadConfig().servers);

  const { buildServer } = await import(dist(["web", "dist", "backend", "server.js"]));
  const { encodeSigned, SESSION_COOKIE } = await import(dist(["web", "dist", "backend", "auth", "auth.js"]));
  const app = buildServer();
  cleanups.push(() => app.close());

  const cookie = `${SESSION_COOKIE}=${encodeSigned({
    uid: SYSADMIN, tag: "dom", guilds: [],
    exp: Date.now() + 60_000, gexp: Date.now() + 60_000,
  })}`;
  const get = (url, headers = {}) => app.inject({ method: "GET", url, headers: { cookie, ...headers } });

  // ── 1. Backups are listed ──────────────────────────────────────────────────
  console.log("\n── report 1: backups listed, downloadable, restorable to a chosen archive");

  const status = await get("/api/status");
  const server = status.json().servers[0];
  check("/api/status reports wrapper features (was null → Backups tab hidden)",
    server?.features != null, JSON.stringify(server?.features));
  check("features.backupFiles is true, so the Backups tab renders",
    server?.features?.backupFiles === true, JSON.stringify(server?.features));
  check("features.restore is true (backup/restore.sh found)",
    server?.features?.restore === true);
  check("features.scripts.rollback is true (rollback.sh found)",
    server?.features?.scripts?.rollback === true);

  const index = await get("/api/servers/server/backups/files");
  const body = index.json();
  check("the archive index returns every backup, newest first",
    index.statusCode === 200 && body.total === 3 &&
    body.files?.[0]?.name === "world-2026-08-02-08.tar.zst",
    `${index.statusCode} ${JSON.stringify(body).slice(0, 200)}`);
  check("entries carry tier and real sizes",
    body.files?.some((f) => f.tier === "archives/daily" && f.sizeBytes === 8192));

  const target = body.files?.find((f) => f.name === "world-2026-08-01.tar.zst");
  const dl = await get(`/api/servers/server/backups/files/${target?.id}/download`);
  check("a specific archive downloads through the dashboard",
    dl.statusCode === 200 && dl.rawPayload.length === 8192,
    `${dl.statusCode} len=${dl.rawPayload?.length}`);
  check("Content-Length is forwarded so the browser shows progress",
    dl.headers["content-length"] === "8192");
  check("Content-Disposition names the archive",
    String(dl.headers["content-disposition"]).includes("world-2026-08-01.tar.zst"));

  const ranged = await get(`/api/servers/server/backups/files/${target?.id}/download`,
    { range: "bytes=100-199" });
  check("Range is forwarded, so an interrupted download resumes",
    ranged.statusCode === 206 && ranged.rawPayload.length === 100,
    `${ranged.statusCode} len=${ranged.rawPayload?.length}`);

  const restore = await app.inject({
    method: "POST", headers: { cookie },
    url: `/api/servers/server/backups/files/${target?.id}/restore`,
  });
  // Asserting reachability, not success: restore.sh runs under `sudo`, which
  // this container has no reason to have. A 404/403 would mean the route or the
  // capability is wrong; a 502 means it reached the wrapper and the host said no.
  check("restoring THAT archive is reachable (route + capability + id resolve)",
    restore.statusCode !== 404 && restore.statusCode !== 403,
    `${restore.statusCode} ${restore.body?.slice(0, 160)}`);
  check("a restore failure is reported without leaking host paths",
    !/\/home\/|scripts\//.test(restore.body ?? ""), restore.body?.slice(0, 160));

  // ── 2. View log is gone from the Servers view ──────────────────────────────
  console.log("\n── report 2: 'View log' removed from Servers");
  const statusView = fs.readFileSync(
    path.join(root, "src/web/frontend/src/views/StatusView.vue"), "utf-8");
  check("StatusView no longer renders a log pane or toggle",
    !/View log|logServer|toggleLog/.test(statusView));

  // ── 3. Console primes with history ─────────────────────────────────────────
  console.log("\n── report 3: console shows history immediately");
  const lines = [];
  const res = await new Promise((resolve) => {
    app.inject({ method: "GET", url: "/api/servers/server/console/stream",
      headers: { cookie }, payloadAsStream: true }, (err, r) => resolve(r));
  });
  await new Promise((done) => {
    const timer = setTimeout(done, 4000);
    res.stream().on("data", (chunk) => {
      for (const frame of String(chunk).split("\n\n")) {
        const m = /^data: (.*)$/m.exec(frame);
        if (!m) continue;
        try {
          const ev = JSON.parse(m[1]);
          if (ev.type === "line") lines.push(ev.line);
        } catch { /* partial frame */ }
      }
      if (lines.length >= 100) { clearTimeout(timer); done(); }
    });
  });
  check("the console delivers backlog immediately, without waiting for new output",
    lines.length > 0, `received ${lines.length} lines`);
  check("it primes with the last 100 lines (capped, not the whole 150-line log)",
    lines.length === 100, `received ${lines.length}`);
  check("the newest line is present and last",
    lines[lines.length - 1]?.includes("line 150"), lines[lines.length - 1]);
  check("the oldest primed line is line 51, i.e. the tail not the head",
    lines[0]?.includes("line 51"), lines[0]);

  // ── 4. Mod config editor ───────────────────────────────────────────────────
  console.log("\n── report 4: mod config editor");

  const cfgIndex = await get("/api/servers/server/configs");
  const cfgFiles = cfgIndex.json().files ?? [];
  check("config files are indexed across the allow-listed roots",
    cfgIndex.statusCode === 200 &&
    cfgFiles.some((f) => f.relPath === "config/mymod-common.toml") &&
    cfgFiles.some((f) => f.relPath === "server.properties"),
    `${cfgIndex.statusCode} ${JSON.stringify(cfgFiles).slice(0, 200)}`);
  check("ops.json is NOT reachable through the editor",
    !cfgFiles.some((f) => f.relPath === "ops.json"));

  const tomlFile = cfgFiles.find((f) => f.relPath === "config/mymod-common.toml");
  const read = await get(`/api/servers/server/configs/${tomlFile?.id}`);
  const fields = read.json().fields ?? [];
  const spawn = fields.find((f) => f.path.at(-1) === "maxSpawnCount");
  const diff = fields.find((f) => f.path.at(-1) === "difficulty");
  check("a schema is derived from the mod's own comments",
    spawn?.min === 1 && spawn?.max === 64 && spawn?.label === "Max spawn count",
    JSON.stringify(spawn));
  check("Allowed Values become a select",
    JSON.stringify(diff?.options) === JSON.stringify(["PEACEFUL","EASY","NORMAL","HARD"]),
    JSON.stringify(diff));

  const save = await app.inject({
    method: "PUT", url: `/api/servers/server/configs/${tomlFile?.id}`,
    headers: { cookie, "content-type": "application/json" },
    payload: { etag: read.json().etag, edits: [{ path: ["general","maxSpawnCount"], value: 42 }] },
  });
  const onDisk = fs.readFileSync(path.join(serverPath, "config", "mymod-common.toml"), "utf-8");
  check("the edit reaches disk", save.statusCode === 200 && onDisk.includes("maxSpawnCount = 42"),
    `${save.statusCode} ${save.body?.slice(0, 160)}`);
  check("every comment survives the write",
    onDisk.includes("#Range: 1 ~ 64") &&
    onDisk.includes("#Allowed Values: PEACEFUL, EASY, NORMAL, HARD") &&
    onDisk.includes('difficulty = "NORMAL"'));

  const stale = await app.inject({
    method: "PUT", url: `/api/servers/server/configs/${tomlFile?.id}`,
    headers: { cookie, "content-type": "application/json" },
    payload: { etag: read.json().etag, edits: [{ path: ["general","maxSpawnCount"], value: 7 }] },
  });
  check("a stale editor is refused rather than overwriting", stale.statusCode === 409,
    `${stale.statusCode}`);

  const after = await get(`/api/servers/server/configs/${tomlFile?.id}`);
  const snapshot = after.json().snapshots?.[0];
  const reverted = await app.inject({
    method: "POST", url: `/api/servers/server/configs/${tomlFile?.id}/revert`,
    headers: { cookie, "content-type": "application/json" },
    payload: { snapshot },
  });
  check("revert restores the previous contents",
    reverted.statusCode === 200 &&
    fs.readFileSync(path.join(serverPath, "config", "mymod-common.toml"), "utf-8")
      .includes("maxSpawnCount = 8"),
    `${reverted.statusCode}`);

  const policy = await get("/api/servers/server/console/policy");
  check("the console deny-list is served to the UI",
    policy.statusCode === 200 && Array.isArray(policy.json().blockedCommands));
}

main()
  .catch((err) => bad("harness", String(err?.stack ?? err)))
  .finally(async () => {
    for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } }
    console.log(
      failures === 0
        ? "\n\x1b[32m✓ all four dashboard reports verified against a live wrapper\x1b[0m"
        : `\n\x1b[31m✖ ${failures} check(s) failed\x1b[0m`,
    );
    if (failures > 0 && process.env.E2E_DUMP_WRAPPER_LOG) console.log(wrapperLog.slice(-1500));
    process.exit(failures === 0 ? 0 : 1);
  });
