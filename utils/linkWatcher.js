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

// Allow lowercase codes and usernames with underscores or dots
const LINK_CODE_REGEX = /\[.+?\]: <([^>]+)> !link ([A-Za-z0-9]{6})/;

let lastSize = 0;
let codes = {};
let linked = {};
let codesDirty = false;
let linkedDirty = false;
let reading = false;
let saving = false;
let pendingSave = false;

async function loadData() {
  codes = await loadLinkCodes().catch(() => ({}));
  linked = await loadLinkedAccounts().catch(() => ({}));
}

async function saveData() {
  if (saving) {
    // Another save is in progress — mark that we need another save afterwards
    pendingSave = true;
    return;
  }

  saving = true;
  try {
    if (codesDirty) {
      await saveLinkCodes(codes);
      codesDirty = false;
    }
    if (linkedDirty) {
      await saveLinkedAccounts(linked);
      linkedDirty = false;
    }
  } catch (err) {
    console.error("Error saving data:", err);
  } finally {
    saving = false;
    if (pendingSave) {
      pendingSave = false;
      await saveData(); // handle any pending save
    }
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

  // Expired code
  if (Date.now() > expires) {
    delete codes[code];
    codesDirty = true;
    await saveData();

    if (user) {
      user
        .send(`❌ Link code **${code}** has expired. Please request a new one.`)
        .catch(console.error);
    }
    return;
  }

  // Valid link
  linked[discordId] = username;
  linkedDirty = true;
  delete codes[code];
  codesDirty = true;

  await saveData();

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
    if (reading) return; // prevent overlapping reads

    reading = true;
    try {
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
    } finally {
      reading = false;
    }
  });

  console.log("👀 Watching latest.log for !link codes...");
}
