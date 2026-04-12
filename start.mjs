#!/usr/bin/env node

/**
 * start.mjs — Build & run the Minecraft Discord Bot via PM2.
 *
 * This file is plain ESM JavaScript (not TypeScript) because it must
 * run before the TypeScript compilation step it triggers.
 *
 * Usage:
 *   node start.mjs              Start (or restart) in production mode
 *   node start.mjs dev          Start in development mode (with DEBUG)
 *   node start.mjs stop         Stop the bot
 *   node start.mjs restart      Restart the bot
 *   node start.mjs logs         Tail live logs
 *   node start.mjs status       Show PM2 process status
 *   node start.mjs build        Only compile TypeScript, don't start
 *   node start.mjs setup        First-time setup: install deps, build, start
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const APP_NAME = "minecraft-bot";
const ECOSYSTEM = "ecosystem.config.cjs";

// ── Colors ──

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

/** @param {string} msg */
function info(msg) {
  console.log(`${colors.green}[INFO]${colors.reset}  ${msg}`);
}

/** @param {string} msg */
function warn(msg) {
  console.log(`${colors.yellow}[WARN]${colors.reset}  ${msg}`);
}

/**
 * @param {string} msg
 * @returns {never}
 */
function error(msg) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`);
  process.exit(1);
}

// ── Shell helpers ──

/**
 * Run a command, inheriting stdio so the user sees output in real time.
 * @param {string} cmd
 * @param {{ silent?: boolean }} options
 */
function run(cmd, { silent = false } = {}) {
  try {
    execSync(cmd, {
      cwd: __dirname,
      stdio: silent ? "pipe" : "inherit",
      encoding: "utf-8",
    });
  } catch (err) {
    if (!silent) throw err;
  }
}

/**
 * Run a command and return trimmed stdout. Returns null on failure.
 * @param {string} cmd
 * @returns {string | null}
 */
function capture(cmd) {
  try {
    return execSync(cmd, {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if a command exists on PATH.
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

function checkNode() {
  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 18) {
    error(`Node.js >= 18 required (found v${process.versions.node}).`);
  }
}

function checkPm2() {
  if (!commandExists("pm2")) {
    error("PM2 is not installed. Run: npm install -g pm2");
  }
}

function checkConfig() {
  if (!existsSync(resolve(__dirname, "config.json"))) {
    error(
      "config.json not found. Copy config.example.json and fill in your values.",
    );
  }
}

// ── PM2 helpers ──

/**
 * Check whether the app is currently registered (running or stopped) in PM2.
 * @returns {boolean}
 */
function isRegistered() {
  const result = capture(`pm2 describe ${APP_NAME}`);
  return result !== null && !result.includes("doesn't exist");
}

// ── Build ──

/** @param {{ dev?: boolean }} options */
function build({ dev = false } = {}) {
  info("Installing dependencies...");
  if (dev) {
    run("npm install");
  } else {
    // ci is faster and reproducible; fall back to install if lockfile is missing
    const hasLockfile = existsSync(resolve(__dirname, "package-lock.json"));
    run(hasLockfile ? "npm ci --omit=dev" : "npm install --omit=dev");
  }

  info("Compiling TypeScript...");
  run("npx tsc");
  info("Build complete → dist/");
}

// ── Commands ──

/** @param {'production' | 'development'} env */
function start(env = "production") {
  checkPm2();
  checkConfig();

  if (isRegistered()) {
    info("Bot is already running, restarting...");
    run(`pm2 restart ${ECOSYSTEM} --env ${env}`);
  } else {
    info(`Starting bot (${env})...`);
    run(`pm2 start ${ECOSYSTEM} --env ${env}`);
  }

  run("pm2 save --force", { silent: true });
  info("Bot is running. Use 'node start.mjs logs' to watch output.");
}

function stop() {
  checkPm2();
  if (isRegistered()) {
    info("Stopping bot...");
    run(`pm2 stop ${APP_NAME}`);
    info("Bot stopped.");
  } else {
    warn("Bot is not running.");
  }
}

function restart() {
  checkPm2();
  checkConfig();
  info("Rebuilding before restart...");
  build();

  if (isRegistered()) {
    run(`pm2 restart ${APP_NAME}`);
  } else {
    run(`pm2 start ${ECOSYSTEM} --env production`);
  }

  run("pm2 save --force", { silent: true });
  info("Bot restarted.");
}

function logs() {
  checkPm2();
  run(`pm2 logs ${APP_NAME} --lines 50`);
}

function status() {
  checkPm2();
  if (isRegistered()) {
    run(`pm2 describe ${APP_NAME}`);
  } else {
    warn("Bot is not registered with PM2.");
  }
}

function setup() {
  info("Running first-time setup...");
  checkNode();
  checkPm2();
  checkConfig();

  // Ensure required directories exist
  for (const dir of ["logs", "data"]) {
    if (!existsSync(resolve(__dirname, dir))) {
      mkdirSync(resolve(__dirname, dir), { recursive: true });
    }
  }

  build({ dev: true });

  info("Starting bot via PM2...");
  run(`pm2 start ${ECOSYSTEM} --env production`);
  run("pm2 save --force", { silent: true });

  // Try to enable boot persistence (non-fatal if it fails)
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
}

function printUsage() {
  console.log(`
Usage: node start.mjs <command>

Commands:
  start      Build and start in production mode (default)
  dev        Build and start in development mode (DEBUG enabled)
  stop       Stop the bot
  restart    Rebuild and restart the bot
  logs       Tail live PM2 logs
  status     Show PM2 process info
  build      Compile TypeScript only, don't start
  setup      First-time setup: install, build, start, enable boot persistence
`);
}

// ── Main ──

const command = process.argv[2] ?? "start";

switch (command) {
  case "start":
    checkNode();
    build();
    start("production");
    break;

  case "dev":
    checkNode();
    build({ dev: true });
    start("development");
    break;

  case "stop":
    stop();
    break;

  case "restart":
    checkNode();
    restart();
    break;

  case "logs":
    logs();
    break;

  case "status":
    status();
    break;

  case "build":
    checkNode();
    build();
    break;

  case "setup":
    setup();
    break;

  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
