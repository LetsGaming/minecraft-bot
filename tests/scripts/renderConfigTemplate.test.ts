/** AUD-029: the container's first config.json is rendered JSON-safely. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
// @ts-expect-error -- plain .mjs script without type declarations
import { renderTemplate } from "../../scripts/render-config-template.mjs";

const render = renderTemplate as (text: string, env: Record<string, string | undefined>) => string;

describe("renderTemplate", () => {
  it("keeps $schema and fills ${VARS}", () => {
    const out = render('{"$schema":"./config.schema.json","token":"${DISCORD_TOKEN}"}', {
      DISCORD_TOKEN: "abc",
    });
    expect(JSON.parse(out)).toEqual({ $schema: "./config.schema.json", token: "abc" });
  });

  it("escapes quotes and backslashes in values, and blanks unset ones", () => {
    const out = render('{"a":"${A}","b":"${B}"}', { A: 'x"y\\z' });
    expect(JSON.parse(out)).toEqual({ a: 'x"y\\z', b: "" });
  });

  it("renders the shipped template to valid JSON", () => {
    const text = readFileSync(new URL("../../config.template.json", import.meta.url), "utf-8");
    const parsed = JSON.parse(render(text, { DISCORD_TOKEN: 't"k' })) as Record<string, unknown>;
    expect(parsed["$schema"]).toBe("./config.schema.json");
    expect(parsed["token"]).toBe('t"k');
  });
});
