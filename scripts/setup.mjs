#!/usr/bin/env node

/**
 * setup.mjs — Interactive configuration wizard for the Minecraft Discord Bot.
 *
 * Usage:
 *   node setup.mjs          Generate a new config.json interactively
 *   node setup.mjs --edit   Edit an existing config.json
 *
 * Walks the user through every required and optional field,
 * validates inputs where possible, and writes config.json to disk.
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "config.json");

// ── Colours ──

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

/** @param {string} q @returns {Promise<string>} */
function ask(q) {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

/**
 * Prompt with a default value shown in brackets.
 * @param {string} label
 * @param {string} [fallback]
 * @returns {Promise<string>}
 */
async function prompt(label, fallback = "") {
  const suffix = fallback ? ` ${C.dim}[${fallback}]${C.reset}` : "";
  const answer = await ask(`  ${C.cyan}?${C.reset} ${label}${suffix}: `);
  return answer || fallback;
}

/**
 * Yes/no prompt.
 * @param {string} label
 * @param {boolean} [fallback]
 * @returns {Promise<boolean>}
 */
async function confirm(label, fallback = true) {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = await ask(
    `  ${C.cyan}?${C.reset} ${label} ${C.dim}(${hint})${C.reset}: `,
  );
  if (!answer) return fallback;
  return answer.toLowerCase().startsWith("y");
}

/** @param {string} msg */
function heading(msg) {
  console.log(`\n${C.bold}${C.magenta}── ${msg} ──${C.reset}\n`);
}

/** @param {string} msg */
function info(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

/** @param {string} msg */
function warn(msg) {
  console.log(`  ${C.yellow}!${C.reset} ${msg}`);
}

/** @param {string} msg */
function hint(msg) {
  console.log(`  ${C.dim}${msg}${C.reset}`);
}

// ── Validators ──

/** @param {string} s */
function isSnowflake(s) {
  return /^\d{17,20}$/.test(s);
}

/** @param {string} s */
function isToken(s) {
  // Discord bot tokens are base64-ish, usually 59+ chars with dots
  return s.length >= 50 && s.includes(".");
}

// ── Main ──

async function main() {
  const isEdit = process.argv.includes("--edit");

  /** @type {Record<string, any>} */
  let existing = {};
  if (isEdit || existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      warn("Existing config.json could not be parsed, starting fresh.");
      existing = {};
    }
  }

  if (existsSync(CONFIG_PATH) && !isEdit) {
    const overwrite = await confirm(
      "config.json already exists. Overwrite?",
      false,
    );
    if (!overwrite) {
      info("Aborted. Use --edit to modify the existing config.");
      rl.close();
      return;
    }
  }

  console.log(
    `\n${C.bold}${C.green}Minecraft Discord Bot — Setup Wizard${C.reset}`,
  );
  hint(
    "Press Enter to accept defaults shown in [brackets].\n  Leave optional fields empty to skip.\n",
  );

  // ─── Discord credentials ───

  heading("Discord Credentials");
  hint("Create a bot at https://discord.com/developers/applications");

  let token = await prompt("Bot token", existing.token ?? "");
  while (token && !isToken(token)) {
    warn("That doesn't look like a valid bot token.");
    token = await prompt("Bot token");
  }

  let clientId = await prompt(
    "Client ID (Application ID)",
    existing.clientId ?? "",
  );
  while (clientId && !isSnowflake(clientId)) {
    warn("Client ID should be a numeric snowflake (17–20 digits).");
    clientId = await prompt("Client ID");
  }

  // ─── Admin users ───

  heading("Admin Users");
  hint("Discord user IDs that can use admin commands (start/stop/restart).");
  hint(
    "Right-click your profile → Copy User ID (enable Developer Mode first).",
  );

  /** @type {string[]} */
  const adminUsers = [...(existing.adminUsers ?? [])];
  if (adminUsers.length > 0) {
    info(`Current admins: ${adminUsers.join(", ")}`);
  }

  let addMore = adminUsers.length === 0;
  if (adminUsers.length > 0) {
    addMore = await confirm("Add more admin users?", false);
  }

  while (addMore) {
    const id = await prompt("Admin user ID (empty to stop)");
    if (!id) break;
    if (!isSnowflake(id)) {
      warn("Not a valid snowflake, skipping.");
      continue;
    }
    if (!adminUsers.includes(id)) adminUsers.push(id);
    info(`Added ${id}`);
  }

  // ─── Servers ───

  heading("Minecraft Servers");
  hint("Configure one or more Minecraft server instances.");

  /** @type {Record<string, any>} */
  const servers = {};
  const existingServers = existing.servers ?? {};
  const existingServerIds = Object.keys(existingServers);

  if (existingServerIds.length > 0) {
    info(`Existing servers: ${existingServerIds.join(", ")}`);
    for (const id of existingServerIds) {
      const keep = await confirm(`Keep server "${id}"?`, true);
      if (keep) {
        servers[id] = existingServers[id];
        const edit = await confirm(`  Edit "${id}" settings?`, false);
        if (edit) {
          servers[id] = await configureServer(id, existingServers[id]);
        }
      }
    }
  }

  let addServer = Object.keys(servers).length === 0;
  if (!addServer) addServer = await confirm("Add another server?", false);

  while (addServer) {
    const id = await prompt("Server ID (e.g. survival, creative)");
    if (!id) break;
    servers[id] = await configureServer(id, {});
    info(`Server "${id}" configured.`);
    addServer = await confirm("Add another server?", false);
  }

  // ─── Guilds ───

  heading("Discord Guild (Server) Configuration");
  hint("Configure which Discord server gets which features.");

  /** @type {Record<string, any>} */
  const guilds = {};
  const existingGuilds = existing.guilds ?? {};
  const existingGuildIds = Object.keys(existingGuilds);

  if (existingGuildIds.length > 0) {
    for (const gid of existingGuildIds) {
      const keep = await confirm(`Keep guild ${gid}?`, true);
      if (keep) {
        guilds[gid] = existingGuilds[gid];
        const edit = await confirm(`  Edit guild ${gid}?`, false);
        if (edit) {
          guilds[gid] = await configureGuild(
            gid,
            existingGuilds[gid],
            Object.keys(servers),
          );
        }
      }
    }
  }

  let addGuild = Object.keys(guilds).length === 0;
  if (!addGuild) addGuild = await confirm("Add another guild?", false);

  while (addGuild) {
    const gid = await prompt("Guild ID (right-click server → Copy Server ID)");
    if (!gid) break;
    if (!isSnowflake(gid)) {
      warn("Not a valid snowflake.");
      continue;
    }
    guilds[gid] = await configureGuild(gid, {}, Object.keys(servers));
    info(`Guild ${gid} configured.`);
    addGuild = await confirm("Add another guild?", false);
  }

  // ─── Global settings ───

  heading("Global Settings");

  const tpsThreshold = await prompt(
    "TPS warning threshold",
    String(existing.tpsWarningThreshold ?? 15),
  );
  const tpsPollInterval = await prompt(
    "TPS poll interval (ms)",
    String(existing.tpsPollIntervalMs ?? 60000),
  );
  const leaderboardInterval = await prompt(
    "Leaderboard interval (daily/weekly/monthly)",
    existing.leaderboardInterval ?? "weekly",
  );

  // ─── Build config ───

  /** @type {Record<string, any>} */
  const config = {
    token,
    clientId,
    adminUsers,
    servers,
    guilds,
    tpsWarningThreshold: parseInt(tpsThreshold, 10) || 15,
    tpsPollIntervalMs: parseInt(tpsPollInterval, 10) || 60000,
    leaderboardInterval,
  };

  // Preserve any extra keys from the existing config
  if (existing.commands) config.commands = existing.commands;
  if (existing.leaderboard) config.leaderboard = existing.leaderboard;

  // ─── Write ───

  heading("Summary");
  console.log(`  Servers: ${Object.keys(servers).join(", ") || "none"}`);
  console.log(`  Guilds:  ${Object.keys(guilds).length}`);
  console.log(`  Admins:  ${adminUsers.length}`);
  console.log();

  const doWrite = await confirm("Write config.json?", true);
  if (!doWrite) {
    warn("Aborted. No changes written.");
    rl.close();
    return;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  info(`Config written to ${CONFIG_PATH}`);
  console.log();
  hint("Next steps:");
  hint("  node start.mjs setup   — Build & start the bot");
  hint("  node start.mjs dev     — Start in development mode");
  console.log();

  rl.close();
}

/**
 * Configure a single Minecraft server instance.
 * @param {string} id
 * @param {Record<string, any>} existing
 * @returns {Promise<Record<string, any>>}
 */
async function configureServer(id, existing) {
  console.log();
  hint(`Configuring server: ${id}`);

  const serverDir = await prompt(
    "Server directory (absolute path to MC server root)",
    existing.serverDir ?? "",
  );
  const linuxUser = await prompt(
    "Linux user that owns the server files",
    existing.linuxUser ?? "minecraft",
  );
  const screenSession = await prompt(
    "Screen session name",
    existing.screenSession ?? id,
  );

  const useRcon = await confirm("Use RCON?", existing.useRcon ?? true);

  /** @type {Record<string, any>} */
  const server = { serverDir, linuxUser, screenSession, useRcon };

  if (useRcon) {
    server.rconHost = await prompt(
      "RCON host",
      existing.rconHost ?? "localhost",
    );
    server.rconPort = parseInt(
      await prompt("RCON port", String(existing.rconPort ?? 25575)),
      10,
    );
    server.rconPassword = await prompt(
      "RCON password",
      existing.rconPassword ?? "",
    );
  }

  // Optional scriptDir
  const hasScripts = await confirm(
    "Do you have management scripts (start.sh, shutdown.sh, etc.)?",
    !!existing.scriptDir,
  );
  if (hasScripts) {
    server.scriptDir = await prompt(
      "Scripts directory",
      existing.scriptDir ?? "",
    );
  }

  return server;
}

/**
 * Configure features for a single guild.
 * @param {string} guildId
 * @param {Record<string, any>} existing
 * @param {string[]} serverIds
 * @returns {Promise<Record<string, any>>}
 */
async function configureGuild(guildId, existing, serverIds) {
  console.log();
  hint(`Configuring guild: ${guildId}`);

  /** @type {Record<string, any>} */
  const guild = {};

  if (serverIds.length > 1) {
    guild.defaultServer = await prompt(
      `Default server for this guild (${serverIds.join("/")})`,
      existing.defaultServer ?? serverIds[0] ?? "",
    );
  } else if (serverIds.length === 1) {
    guild.defaultServer = serverIds[0];
    info(`Default server: ${serverIds[0]}`);
  }

  // ── Status embed ──
  if (
    await confirm("Enable status embed?", !!existing.statusEmbed?.channelId)
  ) {
    const channelId = await prompt(
      "Status embed channel ID",
      existing.statusEmbed?.channelId ?? "",
    );
    if (channelId) guild.statusEmbed = { channelId };
  }

  // ── Notifications ──
  if (
    await confirm(
      "Enable event notifications (join/leave/death/advancement)?",
      !!existing.notifications?.channelId,
    )
  ) {
    const channelId = await prompt(
      "Notifications channel ID",
      existing.notifications?.channelId ?? "",
    );
    if (channelId) {
      hint("Available events: join, leave, death, advancement, start, stop");
      const events = await prompt(
        "Events to track (comma-separated)",
        (
          existing.notifications?.events ?? [
            "join",
            "leave",
            "death",
            "advancement",
            "start",
            "stop",
          ]
        ).join(", "),
      );
      guild.notifications = {
        channelId,
        events: events
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      };
    }
  }

  // ── Chat bridge ──
  if (await confirm("Enable chat bridge?", !!existing.chatBridge?.channelId)) {
    const channelId = await prompt(
      "Chat bridge channel ID",
      existing.chatBridge?.channelId ?? "",
    );
    if (channelId) {
      guild.chatBridge = { channelId };
      if (serverIds.length > 1) {
        guild.chatBridge.server = await prompt(
          `Bridge to which server? (${serverIds.join("/")})`,
          existing.chatBridge?.server ?? guild.defaultServer ?? "",
        );
      }
    }
  }

  // ── Leaderboard ──
  if (
    await confirm(
      "Enable auto-posting leaderboard?",
      !!existing.leaderboard?.channelId,
    )
  ) {
    const channelId = await prompt(
      "Leaderboard channel ID",
      existing.leaderboard?.channelId ?? "",
    );
    if (channelId) {
      const interval = await prompt(
        "Post interval (daily/weekly/monthly)",
        existing.leaderboard?.interval ?? "weekly",
      );
      guild.leaderboard = { channelId, interval };
    }
  }

  // ── Downtime alerts ──
  if (
    await confirm(
      "Enable downtime alerts?",
      !!existing.downtimeAlerts?.channelId,
    )
  ) {
    const channelId = await prompt(
      "Downtime alerts channel ID",
      existing.downtimeAlerts?.channelId ?? "",
    );
    if (channelId) guild.downtimeAlerts = { channelId };
  }

  // ── TPS alerts ──
  if (
    await confirm("Enable low TPS alerts?", !!existing.tpsAlerts?.channelId)
  ) {
    const channelId = await prompt(
      "TPS alerts channel ID",
      existing.tpsAlerts?.channelId ?? "",
    );
    if (channelId) guild.tpsAlerts = { channelId };
  }

  // ── Channel purge ──
  if (
    await confirm(
      "Enable daily channel purge?",
      !!existing.channelPurge?.channelId,
    )
  ) {
    const channelId = await prompt(
      "Channel to purge daily",
      existing.channelPurge?.channelId ?? "",
    );
    if (channelId) guild.channelPurge = { channelId };
  }

  return guild;
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.reset}`, err.message ?? err);
  rl.close();
  process.exit(1);
});
