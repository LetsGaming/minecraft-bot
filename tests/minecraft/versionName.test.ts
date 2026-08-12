import { describe, it, expect } from "vitest";
import { parseVersionName } from "../../src/core/utils/minecraft/versionName.js";

describe("parseVersionName", () => {
  it("reads a bare vanilla version", () => {
    expect(parseVersionName("1.21.4")).toEqual({
      minecraftVersion: "1.21.4",
      loader: null,
      raw: "1.21.4",
    });
  });

  it("reads the loader when the server prefixes it", () => {
    expect(parseVersionName("Fabric 1.21.4").loader).toBe("Fabric");
    expect(parseVersionName("Paper 1.20.1").loader).toBe("Paper");
    expect(parseVersionName("Paper 1.20.1").minecraftVersion).toBe("1.20.1");
  });

  it("prefers the longer loader name", () => {
    // "NeoForge" contains "Forge"; naming the wrong loader sends someone to
    // install the wrong thing, so the longer match has to win.
    expect(parseVersionName("NeoForge 1.21.1").loader).toBe("NeoForge");
  });

  it("does not match a loader inside a longer word", () => {
    expect(parseVersionName("Paperclip 1.21").loader).toBeNull();
  });

  it("handles two-digit minors and old versions", () => {
    expect(parseVersionName("Forge 1.7.10").minecraftVersion).toBe("1.7.10");
    expect(parseVersionName("1.21").minecraftVersion).toBe("1.21");
  });

  it("keeps the raw string and admits when it found nothing", () => {
    // Servers put marketing copy in this field; guessing would be worse.
    const parsed = parseVersionName("§cBest§f Server §aEU");
    expect(parsed.minecraftVersion).toBeNull();
    expect(parsed.loader).toBeNull();
    expect(parsed.raw).toBe("§cBest§f Server §aEU");
  });

  it("treats a missing version as unknown rather than empty", () => {
    expect(parseVersionName(null)).toEqual({
      minecraftVersion: null,
      loader: null,
      raw: "",
    });
  });
});
