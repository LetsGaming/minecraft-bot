/**
 * The db row-mapping seam (QUAL-01). mapRows/mapRow route reads through a
 * checked mapper, and the `col` accessors throw loudly (naming the column) on
 * type drift instead of silently casting — the guarantee that replaces
 * `.all() as unknown as Row[]`. Exercised against a fake statement so it's a
 * pure unit of the mapping logic, no database needed.
 */
import { describe, it, expect } from "vitest";
import { mapRows, mapRow, col } from "../../src/core/db/rows.js";
import type { SqlStatement } from "../../src/core/db/driver.js";

function stmt(rows: unknown[], one?: unknown): SqlStatement {
  return {
    all: () => rows,
    get: () => one,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
  };
}

describe("mapRows / mapRow", () => {
  it("maps every row through the mapper", () => {
    const out = mapRows(
      stmt([{ n: 1 }, { n: 2 }]),
      (r) => col.int(r, "n") * 10,
    );
    expect(out).toEqual([10, 20]);
  });

  it("passes bind params through to the statement", () => {
    let seen: unknown[] = [];
    const s: SqlStatement = {
      all: (...p) => {
        seen = p;
        return [{ n: 1 }];
      },
      get: () => undefined,
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
    };
    mapRows(s, (r) => col.int(r, "n"), "a", 2);
    expect(seen).toEqual(["a", 2]);
  });

  it("mapRow returns null for an absent row and maps a present one", () => {
    expect(mapRow(stmt([], undefined), (r) => col.text(r, "x"))).toBeNull();
    expect(mapRow(stmt([], { x: "hi" }), (r) => col.text(r, "x"))).toBe("hi");
  });
});

describe("col accessors — drift is loud", () => {
  it("text: returns strings, throws (naming the column) on drift", () => {
    expect(col.text({ name: "bob" }, "name")).toBe("bob");
    expect(() => col.text({ name: 42 }, "name")).toThrow(/"name"/);
    expect(() => col.text({}, "name")).toThrow(/expected string/);
  });

  it("textOrNull: allows null, still rejects wrong types", () => {
    expect(col.textOrNull({ v: null }, "v")).toBeNull();
    expect(col.textOrNull({ v: "x" }, "v")).toBe("x");
    expect(() => col.textOrNull({ v: 1 }, "v")).toThrow(/"v"/);
  });

  it("int: returns numbers, narrows bigint, rejects strings", () => {
    expect(col.int({ t: 1700 }, "t")).toBe(1700);
    expect(col.int({ t: 9007199254740993n }, "t")).toBe(Number(9007199254740993n));
    expect(() => col.int({ t: "1700" }, "t")).toThrow(/"t"/);
  });

  it("bool: maps 0/1 and rejects anything else", () => {
    expect(col.bool({ b: 1 }, "b")).toBe(true);
    expect(col.bool({ b: 0 }, "b")).toBe(false);
    expect(() => col.bool({ b: 2 }, "b")).toThrow(/0 or 1/);
  });

  it("json: parses text, throws on non-string or invalid JSON", () => {
    expect(col.json<{ a: number }>({ p: '{"a":1}' }, "p")).toEqual({ a: 1 });
    expect(() => col.json({ p: 5 }, "p")).toThrow(/expected string/);
    expect(() => col.json({ p: "{bad" }, "p")).toThrow();
  });
});
