import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script helper without type declarations
import { firstSentence } from "../../scripts/lib/firstSentence.mjs";

describe("firstSentence", () => {
  it("stops at the first real sentence end", () => {
    expect(firstSentence("Fixed the crash. It happened on start.")).toBe("Fixed the crash.");
  });

  it("does not cut at dots inside file names, versions or numbers", () => {
    expect(firstSentence("Reads `config.json` and v8.1.0 files, 1.400 chunks at a time. Next.")).toBe(
      "Reads `config.json` and v8.1.0 files, 1.400 chunks at a time.",
    );
    expect(firstSentence("Edit config.json without a restart. More.")).toBe("Edit config.json without a restart.");
  });

  it("does not cut at abbreviations or inside brackets", () => {
    expect(firstSentence("Supports fabric, e.g. Lithium, and more. Rest.")).toBe("Supports fabric, e.g. Lithium, and more.");
    expect(firstSentence("Joins are shown (see docs/admin/setup.md. Section 2) now. Rest.")).toBe(
      "Joins are shown (see docs/admin/setup.md. Section 2) now.",
    );
  });

  it("keeps closing marks and returns unterminated text whole", () => {
    expect(firstSentence("Added **bold.** Then more.")).toBe("Added **bold.**");
    expect(firstSentence("No end here")).toBe("No end here");
  });
});
