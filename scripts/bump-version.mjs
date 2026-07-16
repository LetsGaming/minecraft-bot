#!/usr/bin/env node
/**
 * Bump the project version everywhere and (optionally) cut a release.
 *
 * Usage:
 *   node scripts/bump-version.mjs <version|major|minor|patch> [flags]
 *
 * Version argument:
 *   1.2.3            an explicit semver
 *   major|minor|patch  bump that part of the current version
 *
 * Flags:
 *   --dry-run   show what would change; write nothing, tag nothing
 *   --tag       commit the version files (when the bump changed any) and
 *               create an annotated git tag v<version>. Re-running with --tag
 *               once the files are already committed only creates the tag.
 *   --push      push the branch + the tag — release.yml runs on v* tags and
 *               builds the GitHub release + GHCR image. Implies --tag.
 *   --yes       skip the confirmation prompt
 *
 * Updates: every workspace package.json, package-lock.json (root entry +
 * each workspace entry), and CHANGELOG.md (renames the [Unreleased] section
 * to the new version with today's date and opens a fresh [Unreleased]).
 *
 * The runtime version comes from package.json (the update-notifier reads it),
 * so there is no hard-coded version constant to chase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import readline from "node:readline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Parse args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [bumpArg] = argv.filter((a) => !a.startsWith("--"));

const dryRun = flags.has("--dry-run");
const doPush = flags.has("--push");
const doTag = flags.has("--tag") || doPush;
const assumeYes = flags.has("--yes");

if (!bumpArg) {
  console.error(
    "Usage: node scripts/bump-version.mjs <version|major|minor|patch> " +
      "[--dry-run] [--tag] [--push] [--yes]",
  );
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");

// ── Resolve the target version ────────────────────────────────────────────
const rootPkgPath = path.join(root, "package.json");
const rootPkg = readJson(rootPkgPath);
const current = rootPkg.version;

function resolveVersion(cur, arg) {
  if (/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(arg)) return arg;
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Current version "${cur}" is not semver`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (arg === "major") [maj, min, pat] = [maj + 1, 0, 0];
  else if (arg === "minor") [min, pat] = [min + 1, 0];
  else if (arg === "patch") pat += 1;
  else throw new Error(`Invalid bump "${arg}" — use major|minor|patch or X.Y.Z`);
  return `${maj}.${min}.${pat}`;
}

const version = resolveVersion(current, bumpArg);
const tag = `v${version}`;

// ── Collect the edits (compute first, write once) ─────────────────────────
const workspaces = rootPkg.workspaces ?? [];
const edits = [];

// package.json — root + each workspace
for (const rel of ["package.json", ...workspaces.map((w) => `${w}/package.json`)]) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const json = readJson(p);
  if (json.version === version) continue;
  edits.push({ rel, write: () => writeJson(p, { ...json, version }) });
}

// package-lock.json — root version + each workspace package entry
const lockPath = path.join(root, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);
  let changed = lock.version !== version;
  lock.version = version;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    // "" is the root; the workspace dirs are the only other first-party
    // entries — never touch node_modules/* dependency versions.
    if ((key === "" || workspaces.includes(key)) && entry.version && entry.version !== version) {
      entry.version = version;
      changed = true;
    }
  }
  if (changed) edits.push({ rel: "package-lock.json", write: () => writeJson(lockPath, lock) });
}

// CHANGELOG.md — [Unreleased] → [version] — today, fresh [Unreleased] on top
const clPath = path.join(root, "CHANGELOG.md");
if (fs.existsSync(clPath)) {
  const cl = fs.readFileSync(clPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  if (cl.includes(`## [${version}]`)) {
    // already released in the changelog — leave it
  } else if (cl.includes("## [Unreleased]")) {
    const next = cl.replace(
      "## [Unreleased]",
      `## [Unreleased]\n\n## [${version}] — ${today}`,
    );
    edits.push({ rel: "CHANGELOG.md", write: () => fs.writeFileSync(clPath, next) });
  } else {
    console.warn("! CHANGELOG.md has no [Unreleased] section — skipping it.");
  }
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\nBump ${current} → ${version}${dryRun ? "  (dry run)" : ""}\n`);
if (edits.length === 0) {
  console.log("Everything is already at this version.");
} else {
  for (const e of edits) console.log(`  ${dryRun ? "would update" : "update"}  ${e.rel}`);
}
if (doTag) console.log(`  ${dryRun ? "would tag" : "tag"}       ${tag}${doPush ? "  (+ push)" : ""}`);

if (dryRun) process.exit(0);

// ── Confirm ───────────────────────────────────────────────────────────────
async function confirm() {
  if (assumeYes || (edits.length === 0 && !doTag)) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question("\nProceed? [y/N] ", res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// execFileSync hangs the captured stdio off the error object, and node prints
// every own property of an uncaught error — rethrow a plain one with just the
// message git actually wrote.
const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: root, stdio: "pipe" }).toString().trim();
  } catch (err) {
    const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    throw new Error(`git ${a.join(" ")} failed:${detail ? `\n${detail}` : ` exit ${err.status}`}`);
  }
};

if (doTag) {
  try {
    // A tag is created once. Re-running a half-finished release should say so
    // rather than dying inside git.
    if (git("tag", "--list", tag)) {
      console.error(
        `\n! Tag ${tag} already exists — delete it first if you are redoing the release:` +
          `\n    git tag -d ${tag}` +
          `\n    git push origin :refs/tags/${tag}`,
      );
      process.exit(1);
    }

    // Guard: for a tag, the ONLY pending changes should be the version files we
    // are about to write — otherwise the release would tag half-committed work.
    const dirty = git("status", "--porcelain")
      .split("\n")
      .map((l) => l.slice(3))
      .filter(Boolean)
      .filter((f) => !edits.some((e) => e.rel === f));
    if (dirty.length > 0) {
      console.error(
        "\n! Uncommitted changes other than the version files:\n" +
          dirty.map((f) => `    ${f}`).join("\n") +
          "\n  Commit or stash them first so the release tag is clean.",
      );
      process.exit(1);
    }
  } catch {
    console.error("! Not a git repository (or git unavailable) — cannot --tag.");
    process.exit(1);
  }
}

if (!(await confirm())) {
  console.log("Aborted.");
  process.exit(1);
}

// ── Apply ─────────────────────────────────────────────────────────────────
for (const e of edits) {
  e.write();
  console.log(`  updated ${e.rel}`);
}

if (!doTag) {
  console.log(
    `\nDone. ${edits.length > 0 ? "Commit these, then release with:" : "Release with:"}\n` +
      `  node scripts/bump-version.mjs ${version} --tag --push`,
  );
  process.exit(0);
}

// ── Commit + tag (+ push) ─────────────────────────────────────────────────
// No edits is the normal case for the two-step flow: bump, commit the files
// yourself, come back with --tag. Only the tag is left to do, and committing
// nothing is an error in git.
if (edits.length > 0) {
  git("add", ...edits.map((e) => e.rel));
  git("commit", "-m", `chore(release): ${tag}`);
  console.log(`\n  committed ${edits.length} version file(s)`);
}
git("tag", "-a", tag, "-m", `Release ${tag}`);
console.log(`  tagged ${tag}`);

if (doPush) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  execFileSync("git", ["push", "origin", branch], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["push", "origin", tag], { cwd: root, stdio: "inherit" });
  console.log(`  pushed ${branch} + ${tag} — release.yml will build the release.`);
} else {
  console.log(`  push it to trigger the release:  git push origin HEAD ${tag}`);
}
