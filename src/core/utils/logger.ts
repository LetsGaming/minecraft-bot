import fs from "fs";
import path from "path";
import { formatDatetime } from "./time.js";
import { errMsg } from "./error.js";

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
// Bytes written to LOG_FILE this process, so a long-lived process rotates
// without needing a restart (Docker/PM2 only rotate their own stdout logs).
// Storage audit: rotation used to run only inside initFileLogging() at
// import time, so a container that never restarts never rotated bot.log.
let bytesWritten = 0;

function timestamp(): string {
  return formatDatetime();
}

/** Rotate bot.log → bot.log.1 (overwriting the previous one) and reopen. */
function rotate(): void {
  try {
    stream?.end();
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // best-effort — a failed rotation just means bot.log keeps growing
  }
  try {
    stream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    bytesWritten = 0;
    attachErrorHandler(stream);
  } catch (err) {
    stream = null;
    fileLoggingDisabledReason = errMsg(err);
  }
}

function attachErrorHandler(s: fs.WriteStream): void {
  // An async write failure (permissions, disk full, vanished mount) emits
  // 'error'; without this listener Node would throw it as an uncaught
  // exception and kill the process. Degrade to stdout instead.
  s.on("error", (err) => {
    stream = null;
    fileLoggingDisabledReason = err.message;
    process.stdout.write(
      `[${timestamp()}] [WARN] [logger] File logging disabled: ${err.message}. ` +
        "Continuing with stdout only.\n",
    );
  });
}

function initFileLogging() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    // Rotate on startup too, in case bot.log grew past the cap while the
    // process was stopped (rotate() alone only catches growth while running).
    try {
      const { size } = fs.statSync(LOG_FILE);
      if (size > MAX_LOG_SIZE_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
      } else {
        bytesWritten = size;
      }
    } catch {
      // file doesn't exist yet — nothing to rotate
    }

    const s = fs.createWriteStream(LOG_FILE, { flags: "a" });
    attachErrorHandler(s);
    stream = s;
  } catch (err) {
    // Synchronous failure (usually mkdir/EACCES on the logs mount).
    stream = null;
    fileLoggingDisabledReason = errMsg(err);
  }
}

initFileLogging();

function write(level: string, tag: string, ...args: unknown[]): void {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${timestamp()}] [${level}] [${tag}] ${msg}`;
  process.stdout.write(line + "\n");
  if (stream) {
    if (bytesWritten > MAX_LOG_SIZE_BYTES) rotate();
    if (stream) {
      try {
        stream.write(line + "\n");
        bytesWritten += Buffer.byteLength(line) + 1;
      } catch {
        // A synchronous throw after the stream broke — stdout already has
        // the line, so just stop using the file sink.
        stream = null;
      }
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
