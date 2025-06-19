import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";
import {
  loadLinkCodes,
  loadLinkedAccounts,
  saveLinkCodes,
  saveLinkedAccounts,
} from "./linkUtils.js";
import config from "../config.json" assert { type: "json" };

const logFile = path.join(config.serverDir, "logs", "latest.log");
const logsDir = path.dirname(logFile);

const LINK_CODE_REGEX = /\[.+?\]: <(.+?)> !link ([A-Z0-9]{6})/;

let lastSize = 0;
let codes = {};
let linked = {};
let codesDirty = false;
let linkedDirty = false;

async function loadData() {
  codes = await loadLinkCodes().catch(() => ({}));
  linked = await loadLinkedAccounts().catch(() => ({}));
}

async function saveData() {
  if (codesDirty) {
    await saveLinkCodes(codes);
    codesDirty = false;
  }
  if (linkedDirty) {
    await saveLinkedAccounts(linked);
    linkedDirty = false;
  }
}

async function handleLogLine(line, client) {
  const match = LINK_CODE_REGEX.exec(line);
  if (!match) return;

  const [, username, code] = match;
  const entry = codes[code];
  if (!entry) return;

  const { discordId, expires } = entry;
  const user = client.users.cache.get(discordId);

  if (Date.now() > expires) {
    delete codes[code];
    codesDirty = true;
    if (user) {
      user
        .send(`❌ Link code **${code}** has expired. Please request a new one.`)
        .catch(console.error);
    }
    return;
  }

  linked[discordId] = username;
  linkedDirty = true;
  delete codes[code];
  codesDirty = true;

  saveData().catch(console.error);

  if (user) {
    user
      .send(`✅ Successfully linked to Minecraft user **${username}**.`)
      .catch(console.error);
  }

  console.log(`Linked ${discordId} to ${username}`);
}

async function readNewLines(client) {
  try {
    const stats = await fs.stat(logFile);

    if (stats.size < lastSize) {
      // File was rotated or truncated
      lastSize = 0;
    }
    if (stats.size === lastSize) return;

    const stream = fsSync.createReadStream(logFile, {
      start: lastSize,
      end: stats.size - 1,
    });

    const rl = readline.createInterface({ input: stream });

    for await (const line of rl) {
      await handleLogLine(line, client);
    }

    lastSize = stats.size;
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn("⚠️ latest.log not found (rotation in progress?)");
      lastSize = 0;
    } else {
      console.error("Error reading log file:", err);
    }
  }
}

export async function watchForLinkCodes(client) {
  await loadData();

  try {
    const stats = await fs.stat(logFile);
    lastSize = stats.size;
  } catch {
    lastSize = 0;
  }

  fsSync.watch(logsDir, async (eventType, filename) => {
    if (filename !== "latest.log") return;

    if (eventType === "rename") {
      // Probably deleted or rotated
      try {
        await fs.access(logFile);
        console.log("ℹ️ latest.log reappeared after rename/rotation");
        lastSize = 0;
      } catch {
        return; // still missing, wait for next event
      }
    }

    if (eventType === "change") {
      await readNewLines(client);
    }
  });

  console.log("👀 Watching latest.log for !link codes...");
}
