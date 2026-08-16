import { describe, it, expect } from "vitest";

/**
 * The dashboard's category ordering and labelling. Mirrors the view-local
 * logic in CommandsView so the contract is testable without mounting. The
 * derivation itself (categoryOf) is owned by the real shared loader and
 * tested in tests/commands/loadCommandFiles.test.ts — not duplicated here.
 */
const ORDER = [
  "connection", "server", "moderation", "admin",
  "info", "stats", "communication", "general", "shared", "other",
];
function rank(c: string): number {
  const i = ORDER.indexOf(c);
  return i === -1 ? ORDER.length : i;
}
function categoryLabel(category: string): string {
  if (category === "other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

describe("category ordering and labels", () => {
  it("orders known categories by the fixed list, not alphabetically", () => {
    const shuffled = ["general", "connection", "admin"];
    expect([...shuffled].sort((a, b) => rank(a) - rank(b))).toEqual([
      "connection", "admin", "general",
    ]);
  });

  it("sends an unknown category to the end", () => {
    expect(rank("wibble")).toBeGreaterThanOrEqual(ORDER.length);
  });

  it("labels a category by capitalising, with Other as the empty bucket", () => {
    expect(categoryLabel("connection")).toBe("Connection");
    expect(categoryLabel("other")).toBe("Other");
  });
});
