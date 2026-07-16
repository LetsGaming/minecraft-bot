#!/usr/bin/env node
/**
 * Guard: src/ holds workspaces and nothing else.
 *
 * A stray file at src/ root is invisible to every gate — it is in no
 * tsconfig project so tsc never compiles it, eslint lints it but resolves
 * no imports so its broken ones pass, and vitest only globs tests/. Two
 * files from a different repo lived there for hours and shipped four times
 * before anyone looked at a directory listing.
 *
 * Anything that belongs to the bot belongs in a workspace. Anything that
 * does not belong to the bot does not belong in src/.
 */
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["bot", "core", "schema", "web"];

const entries = readdirSync(path.join(root, "src"), { withFileTypes: true });
const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name);

const problems = [];
for (const f of files) problems.push(`src/${f} — stray file; src/ holds workspaces only`);
for (const d of dirs) {
  if (!WORKSPACES.includes(d)) problems.push(`src/${d}/ — unknown workspace`);
}
for (const w of WORKSPACES) {
  if (!dirs.includes(w)) problems.push(`src/${w}/ — expected workspace is missing`);
}

if (problems.length > 0) {
  console.error("✖ src/ layout:");
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ src/ layout OK (${WORKSPACES.join(", ")})`);
