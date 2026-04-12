import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "bot.log");
const stream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function timestamp() {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

function write(level, tag, ...args) {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${timestamp()}] [${level}] [${tag}] ${msg}`;
  console.log(line);
  stream.write(line + "\n");
}

export const log = {
  info: (tag, ...args) => write("INFO", tag, ...args),
  warn: (tag, ...args) => write("WARN", tag, ...args),
  error: (tag, ...args) => write("ERROR", tag, ...args),
  debug: (tag, ...args) => {
    if (process.env.DEBUG) write("DEBUG", tag, ...args);
  },
};
