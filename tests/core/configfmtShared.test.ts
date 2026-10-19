import { describe, it, expect } from "vitest";
import {
  applyConfigEdits,
  parseConfig,
  ConfigEditError,
} from "../../src/core/utils/configfmt/index.js";
import {
  CommentBlock,
  scanOutsideQuotes,
} from "../../src/core/utils/configfmt/lines.js";

describe("scanOutsideQuotes", () => {
  it("skips quoted text and honours escapes only inside double quotes", () => {
    const seen: string[] = [];
    scanOutsideQuotes(`a"b\\"c"d'e\\'f`, (ch) => {
      seen.push(ch);
    });
    expect(seen.join("")).toBe("ad" + "f");
  });

  it("stops at the first true and reports its index", () => {
    expect(scanOutsideQuotes(`"#" # x`, (ch) => ch === "#")).toBe(4);
    expect(scanOutsideQuotes("abc", () => false)).toBe(-1);
  });

  it("starts from the given offset", () => {
    expect(scanOutsideQuotes("..x", (ch) => ch === ".", 1)).toBe(1);
  });
});

describe("CommentBlock.addLine", () => {
  it("strips the marker run and one space", () => {
    const block = new CommentBlock();
    block.addLine("## Range: 1 ~ 5");
    block.addLine("; note", ";#");
    block.addLine("!bang", "#!");
    expect(block.take()).toEqual(["Range: 1 ~ 5", "note", "bang"]);
  });
});

describe("integer enforcement", () => {
  const cases: [string, string, string[]][] = [
    ["a.properties", "max-players=20\n", ["max-players"]],
    ["a.toml", "count = 5\n", ["count"]],
    ["a.yml", "count: 5\n", ["count"]],
    ["a.ini", "[s]\ncount = 5\n", ["s", "count"]],
    ["a.json", '{ "count": 5 }', ["count"]],
  ];

  it.each(cases)("%s rejects a fractional value for a whole number", (file, text, path) => {
    expect(() => applyConfigEdits(file, text, [{ path, value: 1.5 }])).toThrow(/whole number/);
  });

  it.each(cases)("%s rejects an unsafe integer", (file, text, path) => {
    expect(() => applyConfigEdits(file, text, [{ path, value: 2 ** 60 }])).toThrow(
      ConfigEditError,
    );
  });

  it.each(cases)("%s still accepts a whole number", (file, text, path) => {
    expect(applyConfigEdits(file, text, [{ path, value: 7 }])).toContain("7");
  });

  it("lets a float setting take fractions", () => {
    expect(applyConfigEdits("a.toml", "ratio = 0.5\n", [{ path: ["ratio"], value: 0.75 }])).toBe(
      "ratio = 0.75\n",
    );
  });

  it("checks every element of a whole-number list", () => {
    expect(() =>
      applyConfigEdits("a.toml", "ids = [1, 2]\n", [{ path: ["ids"], value: [1, 2.5] }]),
    ).toThrow(/whole number/);
  });
});

describe("JSON duplicate keys", () => {
  it("lists repeated keys read-only under numbered paths", () => {
    const parsed = parseConfig("a.json", '{ "a": 1, "a": 2 }');
    expect(parsed.nodes.map((n) => [n.path.join("."), n.readOnly])).toEqual([
      ["a#1", true],
      ["a#2", true],
    ]);
  });
});

describe("YAML continuation lines", () => {
  const folded = "motd: first line\n  second: line\nport: 25565\n";

  it("marks a value continued on deeper lines read-only", () => {
    const nodes = parseConfig("a.yml", folded).nodes;
    expect(nodes.find((n) => n.key === "motd")?.readOnly).toBe(true);
    expect(nodes.find((n) => n.key === "port")?.readOnly).toBeUndefined();
  });

  it("does not turn a continuation containing `word: x` into a node", () => {
    const keys = parseConfig("a.yml", folded).nodes.map((n) => n.key);
    expect(keys).toEqual(["motd", "port"]);
  });

  it("refuses an edit that would leave the continuation folded onto the new value", () => {
    expect(() =>
      applyConfigEdits("a.yml", folded, [{ path: ["motd"], value: "changed" }]),
    ).toThrow(/cannot rewrite safely/);
  });

  it("skips the continuation of an unclosed quoted scalar", () => {
    const text = 'motd: "one\n  two: x"\nport: 1\n';
    expect(parseConfig("a.yml", text).nodes.map((n) => n.key)).toEqual(["port"]);
  });
});
