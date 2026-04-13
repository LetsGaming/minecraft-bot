#!/usr/bin/env node

/**
 * start.mjs — Build & run the Minecraft Discord Bot via PM2.
 *
 * Plain ESM JavaScript — must run before the TypeScript build it triggers.
 *
 * Usage:
 *   node start.mjs              Build and start in production mode (default)
 *   node start.mjs dev          Build and start in development mode
 *   node start.mjs stop         Stop the bot
 *   node start.mjs restart      Rebuild and restart
 *   node start.mjs logs         Tail live logs
 *   node start.mjs status       Show PM2 process info
 *   node start.mjs build        Compile TypeScript only
 *   node start.mjs setup        First-time setup: install, build, start
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);

const APP_NAME = "minecraft-bot";
const ECOSYSTEM = "ecosystem.config.cjs";

// ── Logging ──

const COLORS = /** @type {const} */ ({
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
});

/** @param {string} msg */
const info = (msg) =>
  console.log(`${COLORS.green}[INFO]${COLORS.reset}  ${msg}`);

/** @param {string} msg */
const warn = (msg) =>
  console.log(`${COLORS.yellow}[WARN]${COLORS.reset}  ${msg}`);

/**
 * @param {string} msg
 * @returns {never}
 */
function fatal(msg) {
  console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${msg}`);
  process.exit(1);
}

// ── Shell helpers ──

/**
 * Run a command with real-time output.
 * @param {string} cmd
 * @param {{ silent?: boolean }} [opts]
 */
function run(cmd, { silent = false } = {}) {
  execSync(cmd, {
    cwd: ROOT,
    stdio: silent ? "pipe" : "inherit",
    encoding: "utf-8",
  });
}

/**
 * Run a command silently; swallow errors.
 * @param {string} cmd
 */
function runQuiet(cmd) {
  try {
    run(cmd, { silent: true });
  } catch {
    // intentionally swallowed
  }
}

/**
 * Run a command and return trimmed stdout, or null on failure.
 * @param {string} cmd
 * @returns {string | null}
 */
function capture(cmd) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {string} bin
 * @returns {boolean}
 */
function commandExists(bin) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// ── Preflight checks ──

function requireNode18() {
  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 18) {
    fatal(`Node.js >= 18 required (found v${process.versions.node}).`);
  }
}

function requirePm2() {
  if (!commandExists("pm2")) {
    fatal("PM2 is not installed. Run: npm install -g pm2");
  }
}

function requireConfig() {
  if (!existsSync(resolve(ROOT, "config.json"))) {
    fatal(
      "config.json not found. Copy config.example.json and fill in your values.",
    );
  }
}

// ── PM2 helpers ──

/** @returns {boolean} */
function isRegistered() {
  const result = capture(`pm2 describe ${APP_NAME}`);
  return result !== null && !result.includes("doesn't exist");
}

/**
 * Start or restart the PM2 process.
 * @param {'production' | 'development'} env
 */
function pm2Start(env) {
  if (isRegistered()) {
    info("Bot already registered — restarting...");
    run(`pm2 restart ${ECOSYSTEM} --env ${env}`);
  } else {
    info(`Starting bot (${env})...`);
    run(`pm2 start ${ECOSYSTEM} --env ${env}`);
  }
  runQuiet("pm2 save --force");
}

// ── Build ──
//
// TypeScript is a devDependency, so we must install ALL deps before compiling.
// After compilation we prune dev deps for a leaner production node_modules.

/** @param {{ prune?: boolean }} [opts] */
function build({ prune = false } = {}) {
  info("Installing dependencies (including devDependencies for tsc)...");
  const hasLockfile = existsSync(resolve(ROOT, "package-lock.json"));
  run(hasLockfile ? "npm ci" : "npm install");

  info("Compiling TypeScript...");
  run("npx tsc");
  info("Build complete → dist/");

  if (prune) {
    info("Pruning devDependencies...");
    run("npm prune --omit=dev", { silent: true });
  }
}

// ── Commands ──

/** @type {Record<string, () => void>} */
const commands = {
  start() {
    requireNode18();
    requireConfig();
    build({ prune: true });
    requirePm2();
    pm2Start("production");
    info("Bot is running. Use 'node start.mjs logs' to watch output.");
  },

  dev() {
    requireNode18();
    requireConfig();
    build();
    requirePm2();
    pm2Start("development");
    info("Bot is running (dev). Use 'node start.mjs logs' to watch output.");
  },

  stop() {
    requirePm2();
    if (!isRegistered()) {
      warn("Bot is not running.");
      return;
    }
    info("Stopping bot...");
    run(`pm2 stop ${APP_NAME}`);
    info("Bot stopped.");
  },

  restart() {
    requireNode18();
    requireConfig();
    info("Rebuilding before restart...");
    build({ prune: true });
    requirePm2();
    pm2Start("production");
    info("Bot restarted.");
  },

  logs() {
    requirePm2();
    run(`pm2 logs ${APP_NAME} --lines 50`);
  },

  status() {
    requirePm2();
    if (!isRegistered()) {
      warn("Bot is not registered with PM2.");
      return;
    }
    run(`pm2 describe ${APP_NAME}`);
  },

  build() {
    requireNode18();
    build();
  },

  setup() {
    info("Running first-time setup...");
    requireNode18();
    requirePm2();
    requireConfig();

    for (const dir of ["logs", "data"]) {
      mkdirSync(resolve(ROOT, dir), { recursive: true });
    }

    build();

    info("Starting bot via PM2...");
    pm2Start("production");

    const startupCmd = capture("pm2 startup");
    if (startupCmd) {
      info(
        "Run the command above to enable boot persistence (if you haven't already).",
      );
    }

    console.log("");
    info("Setup complete! The bot is now running.");
    info("  Logs:    node start.mjs logs");
    info("  Stop:    node start.mjs stop");
    info("  Restart: node start.mjs restart");
    info("  Status:  node start.mjs status");
  },

  help() {
    console.log(`
Usage: node start.mjs <command>

Commands:
  start      Build and start in production mode (default)
  dev        Build and start in development mode
  stop       Stop the bot
  restart    Rebuild and restart the bot
  logs       Tail live PM2 logs
  status     Show PM2 process info
  build      Compile TypeScript only
  setup      First-time setup: install, build, start, enable boot persistence
`);
  },
};

// Aliases
commands["--help"] = commands.help;
commands["-h"] = commands.help;

// ── Main ──

const command = process.argv[2] ?? "start";
const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}

handler();
