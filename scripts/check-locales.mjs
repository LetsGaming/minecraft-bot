#!/usr/bin/env node
/**
 * check-locales.mjs — en/de key parity gate (npm run i18n:check).
 *
 * Every locale must define exactly the same key set: a key added to
 * en.ts but not de.ts silently falls back to English for German guilds,
 * which nobody notices until a user does. Imports the built locale
 * modules when dist/ exists, otherwise extracts keys from the source
 * files with a string-literal scan (good enough for the flat
 * `"key": "value"` shape these files are constrained to).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "de"];

async function loadKeys(locale) {
  const dist = path.join(root, "dist", "common", "locales", `${locale}.js`);
  if (fs.existsSync(dist)) {
    const mod = await import(`file://${dist}`);
    const table = mod.default ?? mod[locale] ?? Object.values(mod)[0];
    return new Set(Object.keys(table));
  }
  // Source fallback: every `"dotted.key":` at the start of a line.
  const src = fs.readFileSync(
    path.join(root, "src", "common", "locales", `${locale}.ts`),
    "utf-8",
  );
  const keys = new Set();
  for (const match of src.matchAll(/^\s*"([\w.]+)":/gm)) {
    keys.add(match[1]);
  }
  return keys;
}

const sets = Object.fromEntries(
  await Promise.all(LOCALES.map(async (l) => [l, await loadKeys(l)])),
);

let failed = false;
for (const a of LOCALES) {
  for (const b of LOCALES) {
    if (a === b) continue;
    const missing = [...sets[a]].filter((k) => !sets[b].has(k));
    if (missing.length > 0) {
      failed = true;
      console.error(
        `✖ ${missing.length} key(s) in ${a}.ts missing from ${b}.ts:`,
      );
      for (const key of missing.sort()) console.error(`  - ${key}`);
    }
  }
}

if (failed) process.exit(1);
console.log(
  `✓ Locales in sync (${LOCALES.join(", ")}; ${sets.en.size} keys each)`,
);
