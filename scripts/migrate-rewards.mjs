#!/usr/bin/env node
/**
 * Upgrade the daily-reward files to entry ids and exceptions.
 *
 *   npm run rewards:migrate -- --dry-run   show what would change, write nothing
 *   npm run rewards:migrate                 do it (the bot and dashboard also do this at startup)
 *
 * Needs a build first (`npm run build`). Honours MCBOT_REWARDS_DIR.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

let migrate;
try {
  ({ migrateRewardFiles: migrate } = await import(
    pathToFileURL(path.join(root, "src", "core", "dist", "rewardsMigration.js")).href
  ));
} catch (err) {
  console.error(`Could not load the built migration (${err instanceof Error ? err.message : err}). Run "npm run build" first.`);
  process.exit(1);
}

const report = await migrate({ dryRun });
const follows = [];
for (const result of report.files) {
  const mark = { unchanged: "=", migrated: "+", removed: "-", skipped: "?", failed: "!" }[result.action];
  console.log(`${mark} ${result.file}  ${result.action}${result.detail ? `  (${result.detail})` : ""}`);
  if (result.followsShared) follows.push(result.file);
}
if (follows.length > 0) {
  console.log(`\nThese overrides were exact copies of the shared rewards and will follow it from now on:\n  ${follows.join("\n  ")}`);
}
console.log(dryRun ? "\nDry run: nothing was written." : "\nOriginals are kept as <file>.pre-exceptions.bak.");
process.exit(report.files.some((r) => r.action === "failed") ? 1 : 0);
