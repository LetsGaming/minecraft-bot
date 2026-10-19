/**
 * The dashboard editor renders a typed control for every node of
 * config.schema.json except a short, explicit allowlist. A new config field
 * with a shape the editor cannot render falls back to a raw JSON textarea;
 * this test turns that silent degradation into a failure.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyField,
  derefNode,
  arrayItemSchema,
  mapValueSchema,
  type Definitions,
  type JsonSchemaNode,
} from "../../src/web/frontend/src/components/schema/schemaField.js";
import { GUILD_FEATURE_KEYS } from "@mcbot/schema";
import { FEATURES as WIZARD_FEATURES } from "../../src/web/frontend/src/composables/useGuildSetup.js";

interface SchemaFile {
  definitions: Record<string, JsonSchemaNode & { properties?: Record<string, unknown> }>;
}

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../config.schema.json", import.meta.url)),
    "utf-8",
  ),
) as SchemaFile;
const defs = schema.definitions as Definitions;

/** Paths (map values and array items shown as `*`) that may stay raw JSON. */
const RAW_JSON_ALLOWLIST = new Set(["webui.trustProxy"]);

function rawJsonPaths(): string[] {
  const found: string[] = [];

  const walk = (node: unknown, path: string, depth = 0): void => {
    if (depth > 12) throw new Error(`schema recursion at ${path}`);
    const resolved = derefNode(node, defs);
    const kind = classifyField(resolved, defs);
    if (kind === "json") {
      found.push(path);
      return;
    }
    if (kind === "object") {
      for (const [key, child] of Object.entries(resolved.properties ?? {})) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    } else if (kind === "map") {
      walk(mapValueSchema(resolved, defs), `${path}.*`, depth + 1);
    } else if (kind === "array") {
      walk(arrayItemSchema(resolved, defs), `${path}.*`, depth + 1);
    }
  };

  walk({ $ref: "#/definitions/RawBotConfig" }, "");
  return found;
}

describe("dashboard editor coverage of config.schema.json", () => {
  it("renders every node with a typed control, except the allowlist", () => {
    const fallbacks = rawJsonPaths().filter((p) => !RAW_JSON_ALLOWLIST.has(p));
    expect(fallbacks).toEqual([]);
  });

  it("keeps the allowlist honest: every entry is still a raw-JSON node", () => {
    const fallbacks = new Set(rawJsonPaths());
    for (const allowed of RAW_JSON_ALLOWLIST) {
      expect(fallbacks.has(allowed), `${allowed} no longer needs the allowlist`).toBe(true);
    }
  });
});

describe("guild feature list", () => {
  const guildProps = Object.keys(schema.definitions.GuildConfig!.properties ?? {});

  it("only names GuildConfig properties", () => {
    for (const key of GUILD_FEATURE_KEYS) {
      expect(guildProps, key).toContain(key);
    }
  });

  it("covers every feature-shaped GuildConfig block", () => {
    // Settings that are not features: scoping, locale, and per-guild overrides.
    const notFeatures = new Set([
      "defaultServer",
      "language",
      "timezone",
      "adminUsers",
      "allowedServers",
      "commands",
    ]);
    const expected = guildProps.filter((k) => !notFeatures.has(k)).sort();
    expect([...GUILD_FEATURE_KEYS].sort()).toEqual(expected);
  });

  it("is the set the setup wizard offers", () => {
    expect(WIZARD_FEATURES.map((f) => f.key).sort()).toEqual([...GUILD_FEATURE_KEYS].sort());
  });
});
