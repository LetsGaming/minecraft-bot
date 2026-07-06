import fs from "fs";
import path from "path";
import { formatDatetime } from "./time.js";

const LOG_DIR = path.resolve(process.cwd(), "logs");

// File logging is best-effort: the process must never die because it
// cannot write its own log file. A read-only or unwritable logs/ mount
// (a real Docker failure mode — a named volume or bind mount the `node`
// user cannot write) previously crashed the process at import time, or
// asynchronously via an unhandled stream 'error' event, producing an
// exit-1 restart loop with no clear cause. If any step fails we fall
// back to stdout only and note it once.
const LOG_FILE = path.join(LOG_DIR, "bot.log");
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

let stream: fs.WriteStream | null = null;
let fileLoggingDisabledReason = "";

function initFileLogging() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    // Docker/PM2 only rotate their own stdout logs, so rotate bot.log
    // ourselves on startup once it exceeds the cap; the previous log is
    // kept as bot.log.1 (overwriting the one before it).
    try {
      const { size } = fs.statSync(LOG_FILE);
      if (size > MAX_LOG_SIZE_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
      }
    } catch {
      // file doesn't exist yet — nothing to rotate
    }

    const s = fs.createWriteStream(LOG_FILE, { flags: "a" });
    // An async write failure (permissions, disk full, vanished mount)
    // emits 'error'; without this listener Node would throw it as an
    // uncaught exception and kill the process. Degrade to stdout instead.
    s.on("error", (err) => {
      stream = null;
      fileLoggingDisabledReason = err.message;
      process.stdout.write(
        `[${timestamp()}] [WARN] [logger] File logging disabled: ${err.message}. ` +
          "Continuing with stdout only.\n",
      );
    });
    stream = s;
  } catch (err) {
    // Synchronous failure (usually mkdir/EACCES on the logs mount).
    stream = null;
    fileLoggingDisabledReason = err instanceof Error ? err.message : String(err);
  }
}

initFileLogging();

function timestamp(): string {
  return formatDatetime();
}

function write(level: string, tag: string, ...args: unknown[]): void {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${timestamp()}] [${level}] [${tag}] ${msg}`;
  process.stdout.write(line + "\n");
  if (stream) {
    try {
      stream.write(line + "\n");
    } catch {
      // A synchronous throw after the stream broke — stdout already has
      // the line, so just stop using the file sink.
      stream = null;
    }
  }
}

// Surface the fallback once, after the log functions exist, so it lands
// in the same stdout stream Docker captures.
if (fileLoggingDisabledReason) {
  process.stdout.write(
    `[${timestamp()}] [WARN] [logger] File logging unavailable ` +
      `(${fileLoggingDisabledReason}). Logging to stdout only — check that ` +
      "the logs/ directory is writable by the runtime user.\n",
  );
}

export const log = {
  info: (tag: string, ...args: unknown[]): void => write("INFO", tag, ...args),
  warn: (tag: string, ...args: unknown[]): void => write("WARN", tag, ...args),
  error: (tag: string, ...args: unknown[]): void =>
    write("ERROR", tag, ...args),
  debug: (tag: string, ...args: unknown[]): void => {
    if (process.env.DEBUG) write("DEBUG", tag, ...args);
  },
};
