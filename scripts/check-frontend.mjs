#!/usr/bin/env node
/**
 * Guard for the dashboard frontend (src/web/frontend/src).
 *
 * ESLint cannot parse .vue or .css here (no Vue parser is installed), so the
 * two rules that must cover single-file components live in this script:
 *
 *  1. Raw hex colours are banned everywhere except tokens.css. Components, the
 *     PrimeVue preset and TypeScript read tokens (`var(--accent)`) instead.
 *  2. The frontend may import only @mcbot/core and @mcbot/schema from the
 *     workspace, and no relative path may leave src/web/frontend/src.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "web", "frontend", "src");
const HEX_HOME = path.join(srcDir, "tokens.css");
const EXTENSIONS = new Set([".vue", ".ts", ".css"]);
const ALLOWED_WORKSPACES = new Set(["@mcbot/core", "@mcbot/schema"]);

const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/g;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const problems = [];

for (const file of walk(srcDir)) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const text = readFileSync(file, "utf8");

  if (file !== HEX_HOME) {
    for (const m of text.matchAll(HEX)) {
      problems.push(`${rel}:${lineOf(text, m.index)} raw hex ${m[0]}; use a token from tokens.css`);
    }
  }

  if (path.extname(file) === ".css") continue;
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[2];
    const where = `${rel}:${lineOf(text, m.index)}`;
    if (spec.startsWith("@mcbot/")) {
      const pkg = spec.split("/").slice(0, 2).join("/");
      if (!ALLOWED_WORKSPACES.has(pkg)) {
        problems.push(`${where} imports ${spec}; the frontend may import only @mcbot/core and @mcbot/schema`);
      }
    } else if (spec.startsWith(".")) {
      const target = path.resolve(path.dirname(file), spec);
      if (path.relative(srcDir, target).startsWith("..")) {
        problems.push(`${where} imports ${spec}, which leaves src/web/frontend/src`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error("frontend check failed:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("frontend check OK (no raw hex outside tokens.css, imports within the boundary)");
