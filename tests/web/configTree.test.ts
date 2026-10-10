import { describe, it, expect } from "vitest";
import {
  displayPath,
  groupFiles,
  limitSections,
  locate,
  pathKey,
  sectionsOf,
} from "../../src/web/frontend/src/utils/configTree.js";

const f = (relPath: string, modId: string) => ({ id: relPath, relPath, modId });

describe("locate / displayPath", () => {
  it("drops the root and the mod's own folder", () => {
    expect(locate("config/xaero/minimap/settings.json", "xaero")).toEqual({
      folder: "minimap",
      name: "settings.json",
    });
    expect(displayPath("config/jei-client.toml", "jei")).toBe("jei-client.toml");
    expect(displayPath("plugins/Essentials/config.yml", "Essentials")).toBe("config.yml");
    expect(displayPath("world/serverconfig/deep/sub/server.toml", "deep")).toBe("sub/server.toml");
    expect(displayPath("server.properties", "server")).toBe("server.properties");
  });

  it("tells two config.json files apart", () => {
    expect(displayPath("config/a/config.json", "a")).toBe("config.json");
    expect(displayPath("config/a/client/config.json", "a")).toBe("client/config.json");
  });
});

describe("groupFiles", () => {
  it("groups by mod then folder", () => {
    const groups = groupFiles([
      f("config/xaero/minimap/a.json", "xaero"),
      f("config/xaero/worldmap/b.json", "xaero"),
      f("config/xaero/c.json", "xaero"),
      f("config/jei.toml", "jei"),
    ]);
    expect(groups.map((g) => [g.modId, g.count])).toEqual([["xaero", 3], ["jei", 1]]);
    expect(groups[0]!.folders.map((x) => x.folder)).toEqual(["", "minimap", "worldmap"]);
  });
});

describe("sections", () => {
  const fields = [
    { path: ["a", "x"] },
    { path: ["root"] },
    { path: ["a", "y"] },
    { path: ["a.b", "c"] },
    { path: ["a", "b.c"] },
  ];

  it("splits by parent path without colliding dotted keys", () => {
    const sections = sectionsOf(fields);
    expect(sections.map((s) => [s.title, s.fields.length])).toEqual([
      ["a", 3],
      ["General", 1],
      ["a.b", 1],
    ]);
  });

  it("keys paths without ambiguity", () => {
    expect(pathKey(["a.b", "c"])).not.toBe(pathKey(["a", "b.c"]));
    expect(pathKey([])).toBe("[]");
  });

  it("limits the fields rendered and counts the rest", () => {
    const { sections, hidden } = limitSections(sectionsOf(fields), 2);
    expect(sections.flatMap((s) => s.fields)).toHaveLength(2);
    expect(hidden).toBe(3);
  });
});
