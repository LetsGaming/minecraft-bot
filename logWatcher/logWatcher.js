import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";
import { getServerConfig } from "../utils/server.js";

const logFile = path.join(getServerConfig().serverDir, "logs", "latest.log");
const logsDir = path.dirname(logFile);

let lastSize = 0;
let reading = false;
const watchers = [];

/**
 * Register a new command watcher.
 * @param {RegExp} regex - Pattern to match against log lines.
 * @param {(match: RegExpExecArray, client: any) => Promise<void>} handler - Async function to handle matches.
 */
export function registerLogCommand(regex, handler) {
  watchers.push({ regex, handler });
}

/**
 * Read new lines from latest.log and dispatch them to registered handlers.
 */
async function readNewLines(client) {
  try {
    const stats = await fs.stat(logFile);
    if (stats.size < lastSize) lastSize = 0; // rotated or truncated
    if (stats.size === lastSize) return;

    const stream = fsSync.createReadStream(logFile, {
      start: lastSize,
      end: stats.size - 1,
    });

    const rl = readline.createInterface({ input: stream });

    for await (const line of rl) {
      for (const { regex, handler } of watchers) {
        const match = regex.exec(line);
        if (match) {
          try {
            await handler(match, client);
          } catch (err) {
            console.error(`Error in log handler for ${regex}:`, err);
          }
        }
      }
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

/**
 * Begin watching the Minecraft server log for registered !commands.
 */
export async function watchServerLog(client) {
  try {
    const stats = await fs.stat(logFile);
    lastSize = stats.size;
  } catch {
    lastSize = 0;
  }

  fsSync.watch(logsDir, async (eventType, filename) => {
    if (filename !== "latest.log") return;
    if (reading) return;
    reading = true;

    try {
      if (eventType === "rename") {
        try {
          await fs.access(logFile);
          console.log("ℹ️ latest.log reappeared after rotation");
          lastSize = 0;
        } catch {
          return; // still missing
        }
      }

      if (eventType === "change") {
        await readNewLines(client);
      }
    } finally {
      reading = false;
    }
  });

  console.log("👀 Watching latest.log for registered !commands...");
}
