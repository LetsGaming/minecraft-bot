/**
 * The config format adapters.
 *
 * The load-bearing test class here is the round trip: parse a real file, write
 * every value back unchanged, assert the output is byte-identical. That is what
 * keeps comments, key order and spacing alive as adapters are added, and it is
 * the property the whole editor rests on — a save that reformats the file is a
 * save nobody will trust twice.
 */
import { describe, it, expect } from "vitest";
import {
  applyConfigEdits,
  formatFor,
  humanizeKey,
  parseConfig,
  schemaFromConfig,
  ConfigEditError,
} from "../../src/core/utils/configfmt/index.js";

// A realistic NeoForge config: comment directives, sections, mixed types.
const FORGE_TOML = `#Common configuration settings
[general]
	#Whether mobs spawn at all.
	#Default: true
	enableSpawning = true
	#How many mobs may spawn per chunk.
	#Range: 1 ~ 64
	#Default: 8
	maxSpawnCount = 8
	#The difficulty the server enforces.
	#Allowed Values: PEACEFUL, EASY, NORMAL, HARD
	#Default: NORMAL
	difficulty = "NORMAL"

[advanced]
	#Dimensions this applies to.
	dimensions = ["minecraft:overworld", "minecraft:the_nether"]
	#Multiplier applied to spawn rates.
	#Range: 0.1 ~ 10.0
	rateMultiplier = 1.5
`;

const SERVER_PROPERTIES = `#Minecraft server properties
#Sat Aug 02 09:00:00 UTC 2026
motd=Welcome to the server # not a comment
max-players=20
online-mode=true
view-distance=10
level-name=world
`;

const FABRIC_JSON = `{
  // Fabric mods sometimes write comments
  "spawnRate": 0.5,
  "enabled": true,
  "biomes": ["plains", "forest"],
  "nested": {
    "threshold": 12
  }
}`;

describe("format detection", () => {
  it("picks an adapter by extension", () => {
    expect(formatFor("common.toml")?.id).toBe("toml");
    expect(formatFor("server.properties")?.id).toBe("properties");
    expect(formatFor("modid.json")?.id).toBe("json");
    expect(formatFor("modid.json5")?.id).toBe("json");
  });

  it("returns null rather than guessing at an unknown type", () => {
    expect(formatFor("world.dat")).toBeNull();
  });
});

// ── The round trip ───────────────────────────────────────────────────────────

describe("round trip is byte-identical", () => {
  for (const [name, text] of [
    ["common.toml", FORGE_TOML],
    ["server.properties", SERVER_PROPERTIES],
    ["modid.json", FABRIC_JSON],
  ] as const) {
    it(`rewrites every value of ${name} without changing a byte`, () => {
      const parsed = parseConfig(name, text);
      expect(parsed.nodes.length).toBeGreaterThan(0);
      const edits = parsed.nodes
        .filter((n) => !n.readOnly)
        .map((n) => ({ path: n.path, value: n.value }));
      expect(applyConfigEdits(name, text, edits)).toBe(text);
    });
  }

  it("keeps CRLF files intact", () => {
    const crlf = SERVER_PROPERTIES.replace(/\n/g, "\r\n");
    const parsed = parseConfig("server.properties", crlf);
    const edits = parsed.nodes.map((n) => ({ path: n.path, value: n.value }));
    expect(applyConfigEdits("server.properties", crlf, edits)).toBe(crlf);
  });
});

// ── TOML ─────────────────────────────────────────────────────────────────────

describe("toml adapter", () => {
  const parsed = parseConfig("common.toml", FORGE_TOML);
  const byKey = (k: string) => parsed.nodes.find((n) => n.key === k)!;

  it("scopes keys to their section", () => {
    expect(byKey("maxSpawnCount").path).toEqual(["general", "maxSpawnCount"]);
    expect(byKey("rateMultiplier").path).toEqual(["advanced", "rateMultiplier"]);
  });

  it("types values", () => {
    expect(byKey("enableSpawning")).toMatchObject({ kind: "boolean", value: true });
    expect(byKey("maxSpawnCount")).toMatchObject({ kind: "number", value: 8 });
    expect(byKey("difficulty")).toMatchObject({ kind: "string", value: "NORMAL" });
    expect(byKey("rateMultiplier")).toMatchObject({ kind: "number", value: 1.5 });
    expect(byKey("dimensions")).toMatchObject({
      kind: "stringList",
      value: ["minecraft:overworld", "minecraft:the_nether"],
    });
  });

  it("attaches only the comment block directly above a key", () => {
    // A blank line ends a block: `dimensions` must not inherit the comments
    // that belonged to `difficulty` two entries earlier.
    expect(byKey("dimensions").comments).toEqual(["Dimensions this applies to."]);
  });

  it("edits one value and touches nothing else", () => {
    const out = applyConfigEdits("common.toml", FORGE_TOML, [
      { path: ["general", "maxSpawnCount"], value: 32 },
    ]);
    expect(out).toContain("maxSpawnCount = 32");
    // Every comment survives, which is the entire point.
    expect(out).toContain("#Range: 1 ~ 64");
    expect(out).toContain("#Allowed Values: PEACEFUL, EASY, NORMAL, HARD");
    expect(out.split("\n").length).toBe(FORGE_TOML.split("\n").length);
  });

  it("applies several edits at once without corrupting later offsets", () => {
    // Front-to-back splicing would shift every span after the first edit.
    const out = applyConfigEdits("common.toml", FORGE_TOML, [
      { path: ["general", "enableSpawning"], value: false },
      { path: ["general", "difficulty"], value: "HARD" },
      { path: ["advanced", "rateMultiplier"], value: 2.25 },
    ]);
    expect(out).toContain("enableSpawning = false");
    expect(out).toContain('difficulty = "HARD"');
    expect(out).toContain("rateMultiplier = 2.25");
    expect(out).toContain("maxSpawnCount = 8");
  });

  it("rewrites a list", () => {
    const out = applyConfigEdits("common.toml", FORGE_TOML, [
      { path: ["advanced", "dimensions"], value: ["minecraft:the_end"] },
    ]);
    expect(out).toContain('dimensions = ["minecraft:the_end"]');
  });

  it("escapes a string that would otherwise break the file", () => {
    const out = applyConfigEdits("common.toml", FORGE_TOML, [
      { path: ["general", "difficulty"], value: 'HA"RD\\x' },
    ]);
    expect(out).toContain('difficulty = "HA\\"RD\\\\x"');
    // And it still parses, which is what the guard below actually checks.
    expect(parseConfig("common.toml", out).nodes.length).toBe(
      parseConfig("common.toml", FORGE_TOML).nodes.length,
    );
  });

  it("ignores a trailing comment when reading, and preserves it when writing", () => {
    const src = `[a]\n\tport = 25565 # the game port\n`;
    const node = parseConfig("x.toml", src).nodes[0]!;
    expect(node.value).toBe(25565);
    const out = applyConfigEdits("x.toml", src, [{ path: ["a", "port"], value: 25566 }]);
    expect(out).toBe(`[a]\n\tport = 25566 # the game port\n`);
  });

  it("marks a multi-line array read-only rather than mangling it", () => {
    const src = `[a]\n\tlist = [\n\t\t"one",\n\t\t"two"\n\t]\n`;
    const node = parseConfig("x.toml", src).nodes.find((n) => n.key === "list")!;
    expect(node.readOnly).toBe(true);
    expect(() =>
      applyConfigEdits("x.toml", src, [{ path: ["a", "list"], value: ["three"] }]),
    ).toThrow(ConfigEditError);
  });

  it("refuses an edit to a key that does not exist", () => {
    expect(() =>
      applyConfigEdits("common.toml", FORGE_TOML, [
        { path: ["general", "nope"], value: 1 },
      ]),
    ).toThrow(/No such setting/);
  });
});

// ── .properties ──────────────────────────────────────────────────────────────

describe("properties adapter", () => {
  const parsed = parseConfig("server.properties", SERVER_PROPERTIES);
  const byKey = (k: string) => parsed.nodes.find((n) => n.key === k)!;

  it("reads flat keys with their types", () => {
    expect(byKey("max-players")).toMatchObject({ kind: "number", value: 20 });
    expect(byKey("online-mode")).toMatchObject({ kind: "boolean", value: true });
  });

  it("treats a mid-line # as part of the value, not a comment", () => {
    // Stripping it would silently rewrite the server's greeting.
    expect(byKey("motd").value).toBe("Welcome to the server # not a comment");
  });

  it("writes values unquoted", () => {
    const out = applyConfigEdits("server.properties", SERVER_PROPERTIES, [
      { path: ["motd"], value: "A new greeting" },
      { path: ["max-players"], value: 40 },
    ]);
    expect(out).toContain("motd=A new greeting");
    expect(out).toContain("max-players=40");
    expect(out).not.toContain('"A new greeting"');
  });
});

// ── JSON ─────────────────────────────────────────────────────────────────────

describe("json adapter", () => {
  const parsed = parseConfig("modid.json", FABRIC_JSON);
  const byPath = (p: string[]) =>
    parsed.nodes.find((n) => n.path.join(".") === p.join("."))!;

  it("walks nested objects into dotted paths", () => {
    expect(byPath(["nested", "threshold"])).toMatchObject({ kind: "number", value: 12 });
  });

  it("treats a scalar array as one editable value", () => {
    expect(byPath(["biomes"])).toMatchObject({ kind: "stringList" });
  });

  it("edits without reformatting the document", () => {
    const out = applyConfigEdits("modid.json", FABRIC_JSON, [
      { path: ["spawnRate"], value: 0.75 },
    ]);
    expect(out).toContain('"spawnRate": 0.75');
    // Comments are not standard JSON, and reserializing would drop this one.
    expect(out).toContain("// Fabric mods sometimes write comments");
    expect(out).toContain('"threshold": 12');
  });

  it("writes a changed array as valid JSON", () => {
    // The round trip above passes because unchanged values are skipped; this
    // is the other half — a value that DID change must still come out valid.
    const out = applyConfigEdits("modid.json", FABRIC_JSON, [
      { path: ["biomes"], value: ["desert", "swamp", "taiga"] },
    ]);
    expect(JSON.parse(out.replace(/\/\/.*$/gm, "")).biomes).toEqual([
      "desert",
      "swamp",
      "taiga",
    ]);
    expect(out).toContain('"spawnRate": 0.5');
  });

  it("leaves the file untouched when nothing actually changed", () => {
    const out = applyConfigEdits("modid.json", FABRIC_JSON, [
      { path: ["spawnRate"], value: 0.5 },
      { path: ["biomes"], value: ["plains", "forest"] },
    ]);
    expect(out).toBe(FABRIC_JSON);
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseConfig("bad.json", "{ this is not json").warning).toBeDefined();
  });
});

// ── Schema derivation ────────────────────────────────────────────────────────

describe("schema derivation", () => {
  const fields = schemaFromConfig(parseConfig("common.toml", FORGE_TOML));
  const field = (k: string) => fields.find((f) => f.path.at(-1) === k)!;

  it("reads a range into min/max", () => {
    expect(field("maxSpawnCount")).toMatchObject({ min: 1, max: 64 });
    expect(field("rateMultiplier")).toMatchObject({ min: 0.1, max: 10 });
  });

  it("reads allowed values into options, so the UI renders a select", () => {
    expect(field("difficulty").options).toEqual(["PEACEFUL", "EASY", "NORMAL", "HARD"]);
  });

  it("reads the default", () => {
    expect(field("difficulty").default).toBe("NORMAL");
  });

  it("keeps the remaining comment lines as the description", () => {
    expect(field("maxSpawnCount").description).toBe(
      "How many mobs may spawn per chunk.",
    );
    // The directives are consumed, not repeated back at the reader.
    expect(field("maxSpawnCount").description).not.toContain("Range:");
  });

  it("falls back to a readable label when a file documents nothing", () => {
    const json = schemaFromConfig(parseConfig("modid.json", FABRIC_JSON));
    expect(json.find((f) => f.path.at(-1) === "spawnRate")?.label).toBe("Spawn rate");
    expect(json.find((f) => f.path.at(-1) === "spawnRate")?.description).toBeUndefined();
  });
});

describe("humanizeKey", () => {
  it("turns identifiers into labels", () => {
    expect(humanizeKey("maxSpawnCount")).toBe("Max spawn count");
    expect(humanizeKey("enable_fancy_graphics")).toBe("Enable fancy graphics");
    expect(humanizeKey("view-distance")).toBe("View distance");
  });
});
