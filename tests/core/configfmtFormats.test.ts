/**
 * Adapters and edge cases added for nested and non-TOML mod configs: colon
 * text (Xaero), Forge .cfg, YAML, INI/conf, TOML array tables and escapes,
 * properties continuations, JSON root arrays.
 */
import { describe, it, expect } from "vitest";
import {
  applyConfigEdits,
  formatFor,
  parseConfig,
  ConfigEditError,
} from "../../src/core/utils/configfmt/index.js";

const roundTrip = (name: string, text: string): string => {
  const parsed = parseConfig(name, text);
  const edits = parsed.nodes.filter((n) => !n.readOnly).map((n) => ({ path: n.path, value: n.value }));
  return applyConfigEdits(name, text, edits);
};

// Shape taken from the real xaerominimap.txt / xaeroworldmap.txt files.
const XAERO_MINIMAP = `#CONFIG ONLY OPTIONS
ignoreUpdate:207
updateNotification:false
#INGAME SETTINGS (DO NOT EDIT!)
minimap:true
zoom:2
minimapOpacity:100.0
minimapItemId:minecraft:compass
interface:dummy:0:36:true:false:false:false
interface:gui.xaero_minimap:155:12:false:false:true:false
#WAYPOINTS HAVE BEEN MOVED TO xaerowaypoints.txt!
`;

const XAERO_WORLDMAP = `ignoreUpdate:0
updateNotification:true
lighting:true
globalVersion:1
`;

const XAERO_WAYPOINTS = `#
#waypoint:name:initials:x:y:z:color:disabled:type:set:rotate_on_tp:tp_yaw:visibility_type:destination
#
sets:gui.xaero_default
waypoint:Home:H:10:64:-20:3:false:0:gui.xaero_default:false:0:0:false
`;

describe("colon text (Xaero)", () => {
  it("claims a .txt only when every line is a comment or key:value", () => {
    expect(formatFor("xaerominimap.txt", XAERO_MINIMAP)?.id).toBe("colon-text");
    expect(formatFor("notes.txt", "hello world\nsecond line\n")).toBeNull();
    expect(formatFor("a.txt")).toBeNull();
  });

  it("leaves waypoint files as plain text", () => {
    expect(formatFor("Overworld_waypoints.txt", XAERO_WAYPOINTS)).toBeNull();
    expect(formatFor("other.txt", XAERO_WAYPOINTS)).toBeNull();
  });

  it("splits at the first colon so values may contain colons", () => {
    const n = parseConfig("xaerominimap.txt", XAERO_MINIMAP).nodes.find((x) => x.key === "minimapItemId")!;
    expect(n.value).toBe("minecraft:compass");
  });

  it("types booleans, ints and floats", () => {
    const by = (k: string) => parseConfig("x.txt", XAERO_MINIMAP).nodes.find((x) => x.key === k)!;
    expect(by("minimap")).toMatchObject({ kind: "boolean", value: true });
    expect(by("zoom")).toMatchObject({ kind: "number", value: 2 });
    expect(by("minimapOpacity")).toMatchObject({ kind: "number", value: 100 });
  });

  it("lists repeated keys read-only with unique paths", () => {
    const rows = parseConfig("x.txt", XAERO_MINIMAP).nodes.filter((n) => n.key === "interface");
    expect(rows.map((r) => r.path[0])).toEqual(["interface#1", "interface#2"]);
    expect(rows.every((r) => r.readOnly)).toBe(true);
  });

  it("round trips byte for byte, including CRLF", () => {
    expect(roundTrip("a.txt", XAERO_MINIMAP)).toBe(XAERO_MINIMAP);
    const crlf = XAERO_WORLDMAP.replace(/\n/g, "\r\n");
    expect(roundTrip("a.txt", crlf)).toBe(crlf);
  });

  it("splices only the edited value, keeping a float a float", () => {
    const out = applyConfigEdits("xaerominimap.txt", XAERO_MINIMAP, [
      { path: ["zoom"], value: 3 },
      { path: ["minimapOpacity"], value: 50 },
      { path: ["minimap"], value: false },
    ]);
    expect(out).toBe(
      XAERO_MINIMAP.replace("zoom:2", "zoom:3")
        .replace("minimapOpacity:100.0", "minimapOpacity:50.0")
        .replace("minimap:true", "minimap:false"),
    );
  });

  it("refuses to edit a repeated key", () => {
    expect(() =>
      applyConfigEdits("x.txt", XAERO_MINIMAP, [{ path: ["interface#1"], value: "x" }]),
    ).toThrow(ConfigEditError);
  });

  it("rejects a value with a line break", () => {
    expect(() =>
      applyConfigEdits("x.txt", XAERO_MINIMAP, [{ path: ["minimapItemId"], value: "a\nb" }]),
    ).toThrow(/line break/);
  });
});

const FORGE_CFG = `# Configuration file

general {
    # Enable the thing
    B:enableThing=true
    I:count=5
    D:ratio=2
    S:name=Hello World
    S:"Quoted Name"=x

    S:list <
        a
        b
     >
}

nested {
    sub {
        I:deep=1
    }
}
`;

describe("forge .cfg", () => {
  it("claims a legacy Forge file and not a foreign .cfg", () => {
    expect(formatFor("mod.cfg", FORGE_CFG)?.id).toBe("forge-cfg");
    expect(formatFor("plain.cfg", "a=1\nb=2\n")?.id).toBe("ini");
    expect(formatFor("odd.cfg", "random words here\n")).toBeNull();
  });

  it("reads blocks as path segments and types by prefix", () => {
    const nodes = parseConfig("mod.cfg", FORGE_CFG).nodes;
    const by = (p: string) => nodes.find((n) => n.path.join(".") === p)!;
    expect(by("general.enableThing")).toMatchObject({ kind: "boolean", value: true });
    expect(by("general.count")).toMatchObject({ kind: "number", value: 5 });
    expect(by("general.name").value).toBe("Hello World");
    expect(by("general.Quoted Name").value).toBe("x");
    expect(by("nested.sub.deep").value).toBe(1);
    expect(by("general.list")).toMatchObject({ readOnly: true, value: ["a", "b"] });
  });

  it("round trips and keeps a double a double", () => {
    expect(roundTrip("mod.cfg", FORGE_CFG)).toBe(FORGE_CFG);
    const out = applyConfigEdits("mod.cfg", FORGE_CFG, [
      { path: ["general", "ratio"], value: 3 },
      { path: ["general", "count"], value: 7 },
    ]);
    expect(out).toContain("D:ratio=3.0");
    expect(out).toContain("I:count=7");
  });

  it("refuses a fraction for an integer", () => {
    expect(() =>
      applyConfigEdits("mod.cfg", FORGE_CFG, [{ path: ["general", "count"], value: 1.5 }]),
    ).toThrow(/whole number/);
  });
});

const YAML = `# Plugin config
language: en   # keep
debug: false
limits:
  max: 10
  ratio: 0.5
  name: 'it''s'
  title: "Hello"
  deep:
    level: 3
messages:
  - hello
  - nested: map
    other: 1
motd: |
  block text
  more
after: ok
anchor: &a value
off: no
`;

describe("yaml", () => {
  const nodes = parseConfig("config.yml", YAML).nodes;
  const by = (p: string) => nodes.find((n) => n.path.join(".") === p);

  it("reads nested scalars", () => {
    expect(by("language")).toMatchObject({ kind: "string", value: "en" });
    expect(by("debug")).toMatchObject({ kind: "boolean", value: false });
    expect(by("limits.max")).toMatchObject({ kind: "number", value: 10 });
    expect(by("limits.name")?.value).toBe("it's");
    expect(by("limits.title")?.value).toBe("Hello");
    expect(by("limits.deep.level")?.value).toBe(3);
    expect(by("after")?.value).toBe("ok");
  });

  it("skips sequences, block scalars, anchors and lists their words read-only", () => {
    expect(by("messages")).toBeUndefined();
    expect(by("nested")).toBeUndefined();
    expect(by("other")).toBeUndefined();
    expect(by("motd")).toBeUndefined();
    expect(by("anchor")).toBeUndefined();
    expect(by("off")?.readOnly).toBe(true);
  });

  it("round trips", () => {
    expect(roundTrip("config.yml", YAML)).toBe(YAML);
  });

  it("edits in place keeping comments and quote style", () => {
    const out = applyConfigEdits("config.yml", YAML, [
      { path: ["language"], value: "de" },
      { path: ["limits", "name"], value: "can't" },
      { path: ["limits", "title"], value: 'say "hi"' },
      { path: ["limits", "ratio"], value: 1 },
    ]);
    expect(out).toContain("language: de   # keep");
    expect(out).toContain("name: 'can''t'");
    expect(out).toContain('title: "say \\"hi\\""');
    expect(out).toContain("ratio: 1.0");
    expect(out).toContain("- nested: map");
  });

  it("quotes a plain string that would change type", () => {
    const out = applyConfigEdits("config.yml", YAML, [{ path: ["language"], value: "true" }]);
    expect(out).toContain('language: "true"   # keep');
  });
});

describe("ini and conf", () => {
  const INI = `; comment
top=1
[server]
name = "My Server"
port=25565
# note
flag = true
`;
  it("reads sections and quoted values", () => {
    const nodes = parseConfig("a.ini", INI).nodes;
    expect(nodes.map((n) => n.path.join("."))).toEqual(["top", "server.name", "server.port", "server.flag"]);
    expect(nodes[1]!.value).toBe("My Server");
  });

  it("edits inside quotes and round trips", () => {
    expect(roundTrip("a.ini", INI)).toBe(INI);
    const out = applyConfigEdits("a.ini", INI, [{ path: ["server", "name"], value: "Other" }]);
    expect(out).toContain('name = "Other"');
  });

  it("claims .conf only for key = value layouts", () => {
    expect(formatFor("a.conf", INI)?.id).toBe("ini");
    expect(formatFor("a.conf", "server {\n  listen 80;\n}\n")).toBeNull();
  });
});

describe("toml edge cases", () => {
  it("splits dotted bare keys and quoted section keys correctly", () => {
    const text = `[server."a.b"]\nx.y = 1\n"q.r" = 2\n`;
    const nodes = parseConfig("a.toml", text).nodes;
    expect(nodes.map((n) => n.path)).toEqual([
      ["server", "a.b", "x", "y"],
      ["server", "a.b", "q.r"],
    ]);
  });

  it("keeps keys under [[array tables]] read-only with unique paths", () => {
    const text = `[[mods]]\nid = "a"\n[[mods]]\nid = "b"\n[mods.extra]\nk = 1\n[after]\nid = "c"\n`;
    const nodes = parseConfig("a.toml", text).nodes;
    expect(nodes.map((n) => n.path.join("/"))).toEqual([
      "mods[1]/id",
      "mods[2]/id",
      "mods[2]/extra/k",
      "after/id",
    ]);
    expect(nodes.slice(0, 3).every((n) => n.readOnly)).toBe(true);
    expect(nodes[3]!.readOnly).toBeUndefined();
    expect(parseConfig("a.toml", text).warning).toBeUndefined();
  });

  it("decodes and re-encodes \\u escapes without corrupting them", () => {
    const text = `name = "caf\\u00e9 \\\\ \\"q\\""\nother = 1\n`;
    const node = parseConfig("a.toml", text).nodes[0]!;
    expect(node.value).toBe('café \\ "q"');
    const out = applyConfigEdits("a.toml", text, [{ path: ["name"], value: "café \u0001" }]);
    expect(out).toContain('name = "café \\u0001"');
    expect(parseConfig("a.toml", out).nodes[0]!.value).toBe("café \u0001");
  });

  it("treats an invalid escape as unknown rather than guessing", () => {
    expect(parseConfig("a.toml", 'x = "a\\qb"\n').nodes[0]!.kind).toBe("unknown");
  });

  it("keeps a float a float when edited to a whole number", () => {
    const out = applyConfigEdits("a.toml", "r = 1.0\ni = 1\n", [
      { path: ["r"], value: 2 },
      { path: ["i"], value: 2 },
    ]);
    expect(out).toBe("r = 2.0\ni = 2\n");
  });

  it("skips multi-line strings and arrays without reading their lines as keys", () => {
    const text = `a = """\nfake = 1\n"""\nlist = [\n  "x",\n  [1],\n]\nb = 2\n`;
    expect(parseConfig("a.toml", text).nodes.map((n) => n.path.join("."))).toEqual(["list", "b"]);
    expect(parseConfig("a.toml", text).nodes[0]!.readOnly).toBe(true);
  });

  it("reads a header with a trailing comment", () => {
    expect(parseConfig("a.toml", "[s] # c\nk = 1\n").nodes[0]!.path).toEqual(["s", "k"]);
  });
});

describe("properties edge cases", () => {
  it("decodes escapes and re-encodes on edit", () => {
    const text = "url=https\\://example.com\npath=a\\\\b\n";
    const nodes = parseConfig("a.properties", text).nodes;
    expect(nodes[0]!.value).toBe("https://example.com");
    expect(nodes[1]!.value).toBe("a\\b");
    expect(applyConfigEdits("a.properties", text, [{ path: ["path"], value: "c\\d" }])).toContain(
      "path=c\\\\d",
    );
    expect(roundTrip("a.properties", text)).toBe(text);
  });

  it("treats continuation lines as part of one read-only value", () => {
    const text = "list=one,\\\n    two,\\\n    three\nnext=1\n";
    const nodes = parseConfig("a.properties", text).nodes;
    expect(nodes.map((n) => n.key)).toEqual(["list", "next"]);
    expect(nodes[0]).toMatchObject({ value: "one,two,three", readOnly: true });
    expect(roundTrip("a.properties", text)).toBe(text);
  });

  it("keeps a newline in an edited value from becoming a second line", () => {
    const out = applyConfigEdits("a.properties", "k=v\n", [{ path: ["k"], value: "a\nb=c" }]);
    expect(out).toBe("k=a\\nb=c\n");
  });
});

describe("json edge cases", () => {
  it("edits a root array of scalars with the empty path", () => {
    const nodes = parseConfig("a.json", '["a", "b"]').nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.path).toEqual([]);
    expect(applyConfigEdits("a.json", '["a", "b"]', [{ path: [], value: ["c"] }])).toBe('["c"]');
  });

  it("addresses the same keys unambiguously whatever they contain", () => {
    const text = '{"a.b": {"c": 1}, "a": {"b.c": 2}, "": 3}';
    const paths = parseConfig("a.json", text).nodes.map((n) => n.path);
    expect(paths).toEqual([["a.b", "c"], ["a", "b.c"], [""]]);
    expect(applyConfigEdits("a.json", text, [{ path: ["a", "b.c"], value: 9 }])).toBe(
      '{"a.b": {"c": 1}, "a": {"b.c": 9}, "": 3}',
    );
  });

  it("decodes \\u escapes in strings", () => {
    expect(parseConfig("a.json", '{"k": "caf\\u00e9"}').nodes[0]!.value).toBe("café");
  });
});
