#!/usr/bin/env node
/**
 * Regenerate the vanilla item list the dashboard's reward editor searches
 * (src/web/frontend/src/data/minecraftItems.json).
 *
 *   node scripts/sync-minecraft-items.mjs            # newest Java version minecraft-data knows
 *   node scripts/sync-minecraft-items.mjs 1.21.4     # a specific version
 *
 * Source: PrismarineJS/minecraft-data (MIT), which lists every item with its
 * English display name and stack size. The list is a search aid only: the
 * editor accepts any item id, so modded items and items newer than this list
 * still work, they just have no friendly name until a mod is detected.
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "src", "web", "frontend", "src", "data", "minecraftItems.json");
const BASE = "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data";

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const paths = await json(`${BASE}/dataPaths.json`);
const versions = Object.keys(paths.pc);
const version = process.argv[2] ?? versions[versions.length - 1];
const itemsPath = paths.pc[version]?.items;
if (!itemsPath) {
  console.error(`No item list for Java ${version}. Known: ${versions.slice(-10).join(", ")}`);
  process.exit(1);
}

const items = await json(`${BASE}/${itemsPath}/items.json`);
const rows = items
  .filter((i) => i.name !== "air")
  .map((i) => [i.name, i.displayName, i.stackSize])
  .sort((a, b) => a[0].localeCompare(b[0]));

// One item per line: a version bump reads as a diff of added and removed items.
const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
writeFileSync(
  out,
  `{\n  "version": ${JSON.stringify(version)},\n  "source": "PrismarineJS/minecraft-data (MIT)",\n  "items": [\n${body}\n  ]\n}\n`,
);
console.log(`Wrote ${rows.length} items for Java ${version} to ${path.relative(root, out)}`);
