#!/usr/bin/env node
/**
 * Render config.template.json into the first config.json of a container
 * (docker-entrypoint.sh). Replaces envsubst, which (AUD-029):
 *
 * - substituted every `$name`, so the template's `"$schema"` key became `""`;
 * - pasted values in raw, so a token or URL containing `"` or `\` produced
 *   invalid JSON.
 *
 * Only `${UPPER_CASE}` placeholders are replaced, each with its environment
 * value escaped for a JSON string (unset means empty, as with envsubst), and
 * the result must parse before it is written.
 *
 * Usage: node render-config-template.mjs <template> <output>
 */
import { readFileSync, writeFileSync } from "node:fs";

export function renderTemplate(text, env) {
  return text.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name) =>
    JSON.stringify(String(env[name] ?? "")).slice(1, -1),
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [template, output] = process.argv.slice(2);
  if (!template || !output) {
    console.error("usage: render-config-template.mjs <template> <output>");
    process.exit(2);
  }
  const rendered = renderTemplate(readFileSync(template, "utf-8"), process.env);
  try {
    JSON.parse(rendered);
  } catch (err) {
    console.error(`ERROR: the rendered config is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  writeFileSync(output, rendered, { flag: "wx", mode: 0o600 });
}
