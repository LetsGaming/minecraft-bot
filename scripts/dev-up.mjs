#!/usr/bin/env node
/**
 * Run this BEFORE doing any manual/dashboard (or bot) work in this repo. Starts an isolated
 * bot process and/or dashboard (Fastify + Vite) pair — own config.json, own SQLite file, own log
 * dir, own free ports — so multiple agents/sessions working in this checkout at once never
 * collide.
 *
 * Real Discord credentials are NOT required by default: this repo's bot needs a live gateway
 * token to do anything, and the dashboard needs a real Discord OAuth app to log in — neither of
 * which an isolated dev/agent session has. So by default:
 *   - the bot skips the Discord gateway login (MCBOT_DEV_NO_DISCORD=1) but still boots config/DB
 *     loading, server capability probing, log watchers, etc. — everything that doesn't need a
 *     live connection. Slash commands / interactions / channel posts won't work in this mode.
 *   - the dashboard skips Discord OAuth (MCBOT_DEV_NO_AUTH=1) and treats every request as a
 *     fixed dev sysadmin — no login screen.
 * Pass --real-discord / --real-auth to opt back into the real thing (requires DISCORD_TOKEN /
 * WEBUI_CLIENT_SECRET already set in your own environment).
 *
 * `--id <name>` (default: "default") namespaces config.json + the SQLite file + logs —
 * data/agent-<id>/, logs/agent-<id>/. `--only bot|web|both` (default: both) picks what to start.
 * Always pair with `scripts/dev-down.mjs --id <name>` when done.
 *
 * ponytail: this repo has no tsx/ts-node dependency (unlike a tsx-based sibling project), so
 * there's no cheap way to run TypeScript directly or per-session-isolate the build output. This
 * script does a one-shot `tsc -b` into the repo's ordinary (shared, not per-id) dist/ dirs before
 * starting node — no live reload, and don't start two dev-up runs at the exact same instant (the
 * build isn't per-session). Re-run dev-up after editing bot/web-backend source. The frontend is
 * unaffected — Vite's own dev server hot-reloads it.
 *
 * Usage: node scripts/dev-up.mjs [--id <name>] [--only bot|web|both] [--real-discord] [--real-auth] [--verbose]
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/parseArgs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEV_ADMIN_UID = "100000000000000001";
const DEV_CLIENT_ID = "100000000000000002";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/** Detached + unref'd so the child outlives this script, output going to a log file. */
function spawnBackground(command, args, { cwd, env, logFile }) {
  const fd = fs.openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    detached: true,
    // Windows-only: npm resolves to a .CMD shim there, and Node's spawn() doesn't
    // auto-resolve PATHEXT-based shims without shell:true. No-op elsewhere. Args are
    // never interpolated into a shell string (spawn still passes them as argv).
    shell: process.platform === "win32",
  });
  child.unref();
  return child;
}

async function main() {
  const { id, only, verbose, realDiscord, realAuth } = parseArgs(process.argv.slice(2));
  const log = (msg) => console.log(`[dev-up:${id}] ${msg}`);

  const wantsBot = only === "bot" || only === "both";
  const wantsWeb = only === "web" || only === "both";

  if (realDiscord && !process.env.DISCORD_TOKEN) {
    console.error("[dev-up] --real-discord requires DISCORD_TOKEN to already be set in your environment.");
    process.exit(1);
  }
  if (realAuth && !process.env.WEBUI_CLIENT_SECRET) {
    console.error("[dev-up] --real-auth requires WEBUI_CLIENT_SECRET to already be set in your environment.");
    process.exit(1);
  }

  const dataDir = path.join(repoRoot, "data", `agent-${id}`);
  const logDir = path.join(repoRoot, "logs", `agent-${id}`);
  const sessionFile = path.join(dataDir, "dev-session.json");
  const configPath = path.join(dataDir, "config.json");
  const dbPath = path.join(dataDir, "bot.db");

  // Defensive: a previous run under this id may have crashed before dev-down.mjs ran.
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const backendPort = wantsWeb ? await getFreePort() : null;
  const vitePort = wantsWeb ? await getFreePort() : null;

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        token: process.env.DISCORD_TOKEN ?? "dev-placeholder-token",
        clientId: process.env.DISCORD_CLIENT_ID ?? DEV_CLIENT_ID,
        adminUsers: [DEV_ADMIN_UID],
        language: "en",
        servers: {
          dev: {
            apiUrl: process.env.MC_API_URL ?? "http://127.0.0.1:1",
            apiKey: process.env.MC_API_KEY ?? "dev-placeholder-key",
          },
        },
        guilds: {},
        webui: {
          enabled: true,
          port: backendPort ?? 8130,
          clientId: process.env.WEBUI_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID ?? DEV_CLIENT_ID,
        },
      },
      null,
      2,
    ),
  );

  const env = {
    ...process.env,
    MCBOT_CONFIG_PATH: configPath,
    MCBOT_DB_PATH: dbPath,
    WEBUI_SESSION_SECRET: randomBytes(32).toString("hex"),
  };
  if (!realDiscord) env.MCBOT_DEV_NO_DISCORD = "1";
  else delete env.MCBOT_DEV_NO_DISCORD;
  if (!realAuth) env.MCBOT_DEV_NO_AUTH = "1";
  else delete env.MCBOT_DEV_NO_AUTH;
  if (backendPort) env.WEBUI_PORT = String(backendPort);
  if (verbose) env.MCBOT_LOG_VERBOSE = "1";

  const buildTargets = [];
  if (wantsBot) buildTargets.push("src/bot");
  if (wantsWeb) buildTargets.push("src/web");

  log(`building (${buildTargets.join(", ")}) — one-shot, no watch...`);
  execFileSync("npm", ["exec", "--", "tsc", "-b", ...buildTargets], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const session = { id, only, dataDir, logDir, startedAt: new Date().toISOString() };

  if (wantsBot) {
    log(`starting bot${realDiscord ? "" : " (MCBOT_DEV_NO_DISCORD=1 — no real Discord login)"}...`);
    const botLog = path.join(logDir, "bot.out.log");
    const bot = spawnBackground("node", ["--enable-source-maps", "src/bot/dist/index.js"], {
      cwd: repoRoot,
      env,
      logFile: botLog,
    });
    // No HTTP endpoint to poll (it's a Discord client, and dev mode never connects to Discord
    // either) — the only signal available is whether the process survived its own startup.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (bot.exitCode !== null) {
      log(`bot exited immediately (code ${bot.exitCode}) — check ${botLog}`);
      process.exit(1);
    }
    log(`bot running (pid ${bot.pid}) — logs: ${botLog}`);
    session.botPid = bot.pid;
  }

  if (wantsWeb) {
    log(`starting dashboard backend on :${backendPort}${realAuth ? "" : " (MCBOT_DEV_NO_AUTH=1 — no login screen)"}...`);
    const backendLog = path.join(logDir, "backend.out.log");
    const backend = spawnBackground("node", ["--enable-source-maps", "src/web/dist/backend/index.js"], {
      cwd: repoRoot,
      env,
      logFile: backendLog,
    });
    const backendReady = await waitForHttp(`http://localhost:${backendPort}/healthz`, 20000);
    if (!backendReady) {
      log(`backend did not respond within 20s — check ${backendLog}`);
      process.exit(1);
    }
    log("backend ready");
    session.backendPid = backend.pid;

    log(`starting frontend on :${vitePort}`);
    const viteLog = path.join(logDir, "vite.out.log");
    const vite = spawnBackground(
      "npm",
      ["run", "dev:frontend", "--workspace=@mcbot/web", "--", "--port", String(vitePort), "--strictPort"],
      { cwd: repoRoot, env, logFile: viteLog },
    );
    const viteReady = await waitForHttp(`http://localhost:${vitePort}/`, 20000);
    if (!viteReady) log(`frontend did not respond within 20s — check ${viteLog}`);
    session.vitePid = vite.pid;
  }

  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));

  console.log("");
  log("ready.");
  if (wantsWeb) {
    console.log(`  Dashboard:  http://localhost:${vitePort}`);
    console.log(`  Backend:    http://localhost:${backendPort}`);
    console.log(`  Auth:       ${realAuth ? "real Discord OAuth" : "open (MCBOT_DEV_NO_AUTH=1) — no login screen"}`);
  }
  if (wantsBot) {
    console.log(`  Bot:        ${realDiscord ? "connected to real Discord" : "running, Discord gateway NOT connected (MCBOT_DEV_NO_DISCORD=1)"}`);
  }
  console.log(`  Config:     ${configPath}`);
  console.log(`  Logs:       ${logDir}`);
  console.log(`  When done:  node scripts/dev-down.mjs --id ${id}`);
  // No process.exit(0): children are detached + unref'd, so the event loop drains on its own
  // once this function returns — matches the pattern used by other node-based dev scripts here.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
