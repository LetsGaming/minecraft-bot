/**
 * AUD-024: a `.` or `..` path segment from user input (a mod slug, a
 * dimension) must not reach fetch, where URL parsing would resolve it into
 * a different wrapper route.
 */
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { instanceUrl } from "../../src/core/utils/server/access/apiClient.js";
import { ModSlugParams, PruneTileParams } from "../../src/web/backend/routes/schemas.js";

const cfg = { id: "smp", apiUrl: "http://w:3030", apiKey: "k" } as never;

describe("instanceUrl", () => {
  it("builds ordinary routes", () => {
    expect(instanceUrl(cfg, "/mods/sodium/update")).toBe("http://w:3030/instances/smp/mods/sodium/update");
  });

  it("refuses dot segments", () => {
    for (const route of ["/mods/../update", "/mods/./x", "/prune/tiles/../1/2", "/mods/.."]) {
      expect(() => instanceUrl(cfg, route)).toThrow(/dot segment/);
    }
    // A dot inside a segment, or in the query string, is fine.
    expect(() => instanceUrl(cfg, "/mods/a..b?x=..")).not.toThrow();
  });
});

describe("route schemas", () => {
  it("accepts real slugs and refuses dot segments", () => {
    expect(Value.Check(ModSlugParams, { id: "smp", slug: "fabric-api" })).toBe(true);
    expect(Value.Check(ModSlugParams, { id: "smp", slug: "Mod.Name_2" })).toBe(true);
    expect(Value.Check(ModSlugParams, { id: "smp", slug: ".." })).toBe(false);
    expect(Value.Check(ModSlugParams, { id: "smp", slug: "." })).toBe(false);
  });

  it("refuses a dimension that is a dot segment", () => {
    const tile = (dimension: string) => ({ id: "smp", dimension, rx: 0, rz: 0 });
    expect(Value.Check(PruneTileParams, tile("minecraft:the_nether"))).toBe(true);
    expect(Value.Check(PruneTileParams, tile(".."))).toBe(false);
    expect(Value.Check(PruneTileParams, tile("."))).toBe(false);
  });
});
