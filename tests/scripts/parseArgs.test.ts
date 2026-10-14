/** AUD-031: dev-up/dev-down delete data/agent-<id>/ recursively, so the id must be a plain name. */
import { describe, it, expect } from "vitest";
// @ts-expect-error -- plain .mjs script without type declarations
import { parseArgs } from "../../scripts/lib/parseArgs.mjs";

const parse = parseArgs as (argv: string[]) => { id: string };

describe("parseArgs --id", () => {
  it("accepts plain session names", () => {
    expect(parse(["--id", "rank-decay-bug"]).id).toBe("rank-decay-bug");
    expect(parse([]).id).toBe("default");
  });

  it("refuses ids that leave data/", () => {
    for (const id of ["x/../../..", "..", "a/b", ".hidden", ""]) {
      expect(() => parse(["--id", id])).toThrow(/--id must be/);
    }
  });
});
