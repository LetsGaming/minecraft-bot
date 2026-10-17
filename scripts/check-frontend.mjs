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
 *  3. Files already moved onto t() (TRANSLATED below) carry no literal UI
 *     text in their template: no words between tags and no static label,
 *     title, placeholder or aria text. Config keys inside <code> are exempt.
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

/** Frontend files whose template text goes through t(); grow this as views migrate. */
const TRANSLATED = new Set([
  "App.vue",
  "components/rewards/ItemPicker.vue",
  "components/rewards/OverrideToggle.vue",
  "views/RewardsView.vue",
  "components/SetupWizard.vue",
  "components/ui/AppShell.vue",
  "components/ui/EditBar.vue",
  "components/ui/EditorShell.vue",
  "components/ui/FieldHint.vue",
  "components/ui/FieldRow.vue",
  "components/ui/InlineBanner.vue",
  "components/ui/InlineError.vue",
  "components/ui/JobBlock.vue",
  "components/ui/ReviewChanges.vue",
  "components/ui/SortControl.vue",
  "components/ui/TypedConfirmDialog.vue",
  "components/schema/ArrayField.vue",
  "components/schema/ConflictPicker.vue",
  "components/schema/GuildConfigEditor.vue",
  "components/schema/MapEntry.vue",
  "components/schema/MapField.vue",
  "components/schema/SchemaField.vue",
  "components/ui/AlertList.vue",
  "views/AnalyticsView.vue",
  "views/AuditView.vue",
  "views/BackupsView.vue",
  "views/CommandsView.vue",
  "views/ConfigView.vue",
  "views/ConsoleView.vue",
  "views/GuildsView.vue",
  "views/ModConfigView.vue",
  "views/ModsView.vue",
  "views/OverviewView.vue",
  "views/StatusView.vue",
]);
const TEXT_ATTRS = /(?<![:@\w.-])(label|title|placeholder|aria-label|alt|header|subtitle|summary|message)="([^"]*)"/g;
const HAS_LETTER = /\p{L}/u;
/** An opening or closing tag; quoted attribute values may contain `>`. */
const TAG = /<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;

function templateOf(text) {
  const start = text.indexOf("<template>");
  const end = text.lastIndexOf("</template>");
  return start === -1 || end === -1 ? null : { body: text.slice(start, end), offset: start };
}

/** Blank out a match but keep its newlines, so reported line numbers stay right. */
function blank(source, pattern) {
  return source.replace(pattern, (m) => m.replace(/[^\n]/g, " "));
}

function literalTextProblems(rel, text) {
  const tpl = templateOf(text);
  if (!tpl) return [];
  let body = blank(tpl.body, /<!--[\s\S]*?-->/g);
  body = blank(body, /\{\{[\s\S]*?\}\}/g);
  body = blank(body, /<code\b[^>]*>[\s\S]*?<\/code>/g);
  const found = [];
  for (const tag of body.matchAll(TAG)) {
    for (const m of tag[0].matchAll(TEXT_ATTRS)) {
      if (HAS_LETTER.test(m[2])) {
        found.push(`${rel}:${lineOf(text, tpl.offset + tag.index + m.index)} literal ${m[1]}="${m[2]}"; bind it to t()`);
      }
    }
  }
  const textOnly = blank(body, TAG);
  for (const m of textOnly.matchAll(/\S[^\n]*/g)) {
    if (HAS_LETTER.test(m[0])) {
      found.push(`${rel}:${lineOf(text, tpl.offset + m.index)} literal text "${m[0].trim()}"; use t()`);
    }
  }
  return found;
}

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
  if (TRANSLATED.has(path.relative(srcDir, file).split(path.sep).join("/"))) {
    problems.push(...literalTextProblems(rel, text));
  }
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
console.log(
  "frontend check OK (no raw hex outside tokens.css, imports within the boundary, no literal text in translated files)",
);
