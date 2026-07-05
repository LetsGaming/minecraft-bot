#!/usr/bin/env node
/**
 * e2e-smoke.mjs — talks to the docker-compose.e2e.yml Paper server
 * through the bot's OWN RCON layer (dist/common/rcon), so a protocol or
 * framing regression fails here before it fails in production.
 *
 * Checks: connect, `list` responds, whitelist add → shows up in
 * `whitelist list`, `say` round-trips without an error response.
 * Requires `npm run build` first (imports from dist/).
 */
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { RconClient } = await import(
  `file://${path.join(root, "dist", "common", "rcon", "RconClient.js")}`
);

const HOST = process.env.E2E_RCON_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.E2E_RCON_PORT ?? "25575", 10);
const PASSWORD = process.env.E2E_RCON_PASSWORD ?? "e2e-smoke-password";

function fail(step, detail) {
  console.error(`✖ ${step}: ${detail}`);
  process.exit(1);
}

async function retry(fn, tries, delayMs, step) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  fail(step, last instanceof Error ? last.message : String(last));
}

// 1. Connect (the server may still be generating the world)
const client = new RconClient(HOST, PORT, PASSWORD, "e2e");
await retry(() => client.connect(), 30, 5000, "rcon connect");
console.log("✓ rcon connect");

// 2. `list` responds with the expected shape
const list = await client.send("list");
if (!/players online/i.test(list)) fail("list", `unexpected reply: ${list}`);
console.log(`✓ list → ${list.trim()}`);

// 3. Whitelist round-trip (offline mode, so any name works)
await client.send("whitelist add E2ESmokeUser");
const wl = await client.send("whitelist list");
if (!wl.includes("E2ESmokeUser")) fail("whitelist", `not listed: ${wl}`);
await client.send("whitelist remove E2ESmokeUser");
console.log("✓ whitelist add/list/remove");

// 4. say goes through without an error reply
const say = await client.send("say e2e smoke complete");
if (/unknown|error/i.test(say)) fail("say", say);
console.log("✓ say");

console.log("E2E smoke: all checks passed");
process.exit(0);
