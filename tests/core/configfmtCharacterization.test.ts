/**
 * Pins behaviour of the config adapters that must survive the nested-config
 * work: deep section nesting, odd spacing, and what each adapter leaves alone.
 */
import { describe, it, expect } from "vitest";
import {
  applyConfigEdits,
  parseConfig,
} from "../../src/core/utils/configfmt/index.js";

describe("toml: nesting and layout", () => {
  const text = [
    "# top comment",
    "[a.b.c.d.e]",
    "  deep = 1   # trailing",
    "[a]",
    "plain = 'literal \n'",
    "",
  ].join("\n");

  it("reads keys under a deeply dotted section", () => {
    const n = parseConfig("x.toml", text).nodes.find((x) => x.key === "deep")!;
    expect(n.path).toEqual(["a", "b", "c", "d", "e", "deep"]);
    expect(n.value).toBe(1);
  });

  it("keeps a literal string verbatim and the trailing comment on edit", () => {
    const out = applyConfigEdits("x.toml", text, [
      { path: ["a", "b", "c", "d", "e", "deep"], value: 2 },
    ]);
    expect(out).toContain("deep = 2   # trailing");
    expect(out).toContain("plain = 'literal \n'");
  });

  it("does not claim lines it cannot read as entries", () => {
    const nodes = parseConfig("x.toml", "just words\n[s]\nk = 1\n").nodes;
    expect(nodes.map((n) => n.path.join("."))).toEqual(["s.k"]);
  });
});

describe("json: nesting", () => {
  it("reaches keys six levels down and edits only that span", () => {
    const text = '{"a":{"b":{"c":{"d":{"e":{"f":1}}}}},"keep":  "x"}';
    const out = applyConfigEdits("x.json", text, [
      { path: ["a", "b", "c", "d", "e", "f"], value: 9 },
    ]);
    expect(out).toBe('{"a":{"b":{"c":{"d":{"e":{"f":9}}}}},"keep":  "x"}');
  });

  it("exposes arrays of objects by index", () => {
    const nodes = parseConfig("x.json", '{"list":[{"n":1},{"n":2}]}').nodes;
    expect(nodes.map((n) => n.path.join("."))).toEqual(["list.0.n", "list.1.n"]);
  });
});

describe("properties: layout", () => {
  it("keeps the separator style and surrounding lines", () => {
    const text = "# c\nkey : old\nother=1\n";
    expect(applyConfigEdits("a.properties", text, [{ path: ["key"], value: "new" }])).toBe(
      "# c\nkey : new\nother=1\n",
    );
  });
});
