/**
 * Generate config.schema.json from the RawBotConfig TypeScript type.
 *
 * This is the single source of truth chain the WebUI plan depends on:
 * RawBotConfig (src/common/types/config.ts) → config.schema.json → editor
 * autocompletion via $schema in config.template.json, Fastify request
 * validation in the future dashboard backend, and schema-driven config
 * forms in dashboard phase 2.
 *
 * Run via `npm run schema:generate` (also part of `npm run build`). The
 * generated file is committed so `$schema` resolves without a build step;
 * CI fails the build if it drifts from the type (see schema:check).
 */
import { createGenerator } from "ts-json-schema-generator";
import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "config.schema.json");

const config = {
  path: path.join(root, "src/common/types/config.ts"),
  tsconfig: path.join(root, "tsconfig.json"),
  type: "RawBotConfig",
  expose: "export",
  topRef: true,
  jsDoc: "extended",
  skipTypeCheck: false,
  additionalProperties: false,
};

const schema = createGenerator(config).createSchema(config.type);

// Stable, human-diffable output: metadata first, then the generated body.
const output = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "minecraft-bot config.json",
  description:
    "Generated from RawBotConfig (src/common/types/config.ts) by scripts/generate-schema.mjs — do not edit by hand.",
  ...schema,
};

const json = JSON.stringify(output, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(outPath) ? readFileSync(outPath, "utf-8") : "";
  if (current !== json) {
    console.error(
      "config.schema.json is out of date with RawBotConfig.\n" +
        "Run `npm run schema:generate` and commit the result.",
    );
    process.exit(1);
  }
  console.log("config.schema.json is up to date.");
} else {
  writeFileSync(outPath, json);
  console.log(`Wrote ${path.relative(root, outPath)}`);
}
