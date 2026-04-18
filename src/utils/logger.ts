import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "bot.log");
const stream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

function write(level: string, tag: string, ...args: unknown[]): void {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${timestamp()}] [${level}] [${tag}] ${msg}`;
  process.stdout.write(line + "\n");
  stream.write(line + "\n");
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
