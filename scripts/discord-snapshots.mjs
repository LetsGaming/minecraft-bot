#!/usr/bin/env node
/**
 * Renders the Discord reply snapshots and prints them as text.
 *
 * Usage:
 *   node scripts/discord-snapshots.mjs            check the fixtures, then print them
 *   node scripts/discord-snapshots.mjs --update   rewrite the fixtures, then print them
 *   node scripts/discord-snapshots.mjs --quiet    check only, print nothing on success
 *
 * The snapshots are vitest tests under tests/bot/discordSnapshots/ that run
 * real commands, watchers and embed builders in English and German and write
 * JSON to tests/fixtures/discord-snapshots/. They also run in `npm test`.
 * See docs/dev/bot/replies.md for how to read them against the rules.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "tests", "fixtures", "discord-snapshots");
const testDir = path.join("tests", "bot", "discordSnapshots");

const args = new Set(process.argv.slice(2));
const update = args.has("--update");
const quiet = args.has("--quiet");

const require = createRequire(path.join(root, "package.json"));
const vitestPkgPath = require.resolve("vitest/package.json");
const vitestPkg = JSON.parse(readFileSync(vitestPkgPath, "utf8"));
const vitestBin = path.join(
  path.dirname(vitestPkgPath),
  typeof vitestPkg.bin === "string" ? vitestPkg.bin : vitestPkg.bin.vitest,
);

const run = spawnSync(
  process.execPath,
  [vitestBin, "run", testDir, ...(update ? ["--update"] : [])],
  { cwd: root, stdio: "inherit" },
);
if (run.status !== 0) process.exit(run.status ?? 1);
if (quiet) process.exit(0);

const out = [];
const line = (depth, text) => out.push(`${"  ".repeat(depth)}${text}`);

function printMessage(m, depth) {
  const visibility = m.ephemeral === undefined ? "" : m.ephemeral ? " (only the invoker)" : " (public)";
  line(depth, `> ${m.via}${visibility}`);
  if (m.content) line(depth + 1, `content: ${m.content}`);
  if (m.allowedMentions) line(depth + 1, `allowedMentions: ${JSON.stringify(m.allowedMentions)}`);
  for (const e of m.embeds ?? []) {
    line(depth + 1, `embed ${e.color ?? "(no colour)"}${e.timestamp ? ", timestamp" : ""}`);
    if (e.author) line(depth + 2, `author: ${e.author.name}`);
    if (e.title) line(depth + 2, `title: ${e.title}`);
    if (e.description) {
      for (const [i, text] of e.description.split("\n").entries()) {
        line(depth + 2, `${i === 0 ? "description: " : "             "}${text}`);
      }
    }
    for (const f of e.fields ?? []) {
      line(depth + 2, `field${f.inline ? " (inline)" : ""} ${f.name}: ${f.value.replace(/\n/g, " / ")}`);
    }
    if (e.footer) line(depth + 2, `footer: ${e.footer.text}`);
  }
  for (const row of m.components ?? []) {
    line(depth + 1, `buttons: ${row.map((b) => `[${b.label}${b.disabled ? ", off" : ""}, ${b.style}]`).join(" ")}`);
  }
}

function walk(value, depth) {
  if (Array.isArray(value)) {
    for (const m of value) printMessage(m, depth);
    return;
  }
  if (value && typeof value === "object" && "via" in value) {
    printMessage(value, depth);
    return;
  }
  for (const [key, child] of Object.entries(value ?? {})) {
    if (child && typeof child === "object" && ("color" in child || "title" in child)) {
      line(depth, `${key}:`);
      printMessage({ via: "embed", embeds: [child] }, depth + 1);
    } else if (Array.isArray(child) && child.length > 0 && "label" in child[0]) {
      printMessage({ via: key, components: [child] }, depth);
    } else if (child === null || typeof child !== "object") {
      line(depth, `${key}: ${child}`);
    } else {
      line(depth, `${key}:`);
      walk(child, depth + 1);
    }
  }
}

for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).sort()) {
  line(0, `=== ${file.replace(/\.json$/, "")}`);
  walk(JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")), 1);
  line(0, "");
}
console.log(out.join("\n"));
