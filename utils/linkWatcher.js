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

const LINK_CODE_REGEX = /\[.+?\]: <(.+?)> !link ([A-Z0-9]{6})/;

let lastSize = 0;
let codes = {};
let linked = {};
let codesDirty = false;
let linkedDirty = false;

// Load data at startup
async function loadData() {
  codes = await loadLinkCodes().catch(() => ({}));
  linked = await loadLinkedAccounts().catch(() => ({}));
}

// Save data if changed
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

// Handle each line from the log file
async function handleLogLine(line, client) {
  const match = LINK_CODE_REGEX.exec(line);
  if (!match) return;

  const [, username, code] = match;

  if (!(code in codes)) return;

  const user = client.users.cache.get(discordId);
  if (Date.now() > codes[code].expires) {
    delete codes[code];
    codesDirty = true;
    if (user) {
      user.send(
        `❌ Link code **${code}** has expired. Please request a new one.`
      );
    }
    return;
  }

  const { discordId } = codes[code];
  linked[discordId] = username;
  linkedDirty = true;

  delete codes[code];
  codesDirty = true;

  // Save changes asynchronously, but don't block line handling
  saveData().catch(console.error);

  if (user) {
    user.send(`✅ Successfully linked to Minecraft user **${username}**.`);
  }

  console.log(`Linked ${discordId} to ${username}`);
}

export async function watchForLinkCodes(client) {
  await loadData();

  // Initialize lastSize
  try {
    const stats = await fs.stat(logFile);
    lastSize = stats.size;
  } catch {
    lastSize = 0;
  }

  // Watch the log file for changes
  fsSync.watch(logFile, async (eventType) => {
    if (eventType !== "change") return;

    try {
      const stats = await fs.stat(logFile);

      // Reset if file truncated or rotated
      if (stats.size < lastSize) lastSize = 0;

      if (stats.size === lastSize) return;

      const stream = fsSync.createReadStream(logFile, {
        start: lastSize,
        end: stats.size - 1, // end is inclusive
      });

      const rl = readline.createInterface({ input: stream });

      for await (const line of rl) {
        await handleLogLine(line, client);
      }

      lastSize = stats.size;
    } catch (err) {
      console.error("Error reading log file:", err);
    }
  });
}
