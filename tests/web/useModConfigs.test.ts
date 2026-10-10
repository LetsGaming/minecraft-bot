import { describe, it, expect, vi, beforeEach } from "vitest";

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { useModConfigs } from "../../src/web/frontend/src/composables/useModConfigs.js";

const file = (relPath: string, modId: string, id = relPath) => ({
  id, relPath, modId, format: "json", editable: true, tooLarge: false, sizeBytes: 1, mtimeMs: 1,
});

function contents(fields: { path: string[]; label: string; kind: string; value: unknown }[], extra = {}) {
  return {
    file: file("config/a.json", "a", "A".repeat(22)),
    etag: "e1",
    snapshots: [],
    fields,
    supported: true,
    readOnly: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  net.apiSend.mockResolvedValue({ etag: "e2", snapshot: "s" });
});

describe("useModConfigs", () => {
  it("keeps fields whose paths join to the same dotted string apart", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [], truncated: false });
    await m.loadFiles("smp");
    net.apiGet.mockResolvedValueOnce(
      contents([
        { path: ["a.b", "c"], label: "C", kind: "number", value: 1 },
        { path: ["a", "b.c"], label: "C", kind: "number", value: 2 },
      ]),
    );
    await m.openFile("A".repeat(22));
    const [first, second] = m.current.value!.fields;
    m.setFromInput(first!, 10);
    expect(m.isDirty(first!)).toBe(true);
    expect(m.isDirty(second!)).toBe(false);
    await m.save();
    expect(net.apiSend.mock.calls[0]![2].edits).toEqual([{ path: ["a.b", "c"], value: 10 }]);
  });

  it("sends the empty path of a root array", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [] });
    await m.loadFiles("smp");
    net.apiGet.mockResolvedValueOnce(contents([{ path: [], label: "", kind: "stringList", value: ["x"] }]));
    await m.openFile("A".repeat(22));
    m.setFromInput(m.current.value!.fields[0]!, ["y"]);
    await m.save();
    expect(net.apiSend.mock.calls[0]![2].edits).toEqual([{ path: [], value: ["y"] }]);
  });

  it("groups files by mod and folder and exposes the truncated flag", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({
      files: [
        file("config/xaero/minimap/settings.json", "xaero"),
        file("config/xaero/worldmap/settings.json", "xaero"),
      ],
      truncated: true,
    });
    await m.loadFiles("smp");
    expect(m.truncated.value).toBe(true);
    expect(m.byMod.value[0]!.folders.map((f) => f.folder)).toEqual(["minimap", "worldmap"]);
  });

  it("filters files by path and keeps the mod list when typing a setting name", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [file("config/a/x.json", "a")] });
    await m.loadFiles("smp");
    m.search.value = "spawnRate";
    expect(m.byMod.value).toHaveLength(0);
    expect(m.filtering.value).toBe(true);
  });

  it("reports a read-only file so the form can lock", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [] });
    await m.loadFiles("smp");
    net.apiGet.mockResolvedValueOnce(contents([], { readOnly: true, warning: "broken", text: "{" }));
    await m.openFile("A".repeat(22));
    expect(m.fileReadOnly.value).toBe(true);
  });

  it("renders at most one page of fields and reveals more on request", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [] });
    await m.loadFiles("smp");
    const many = Array.from({ length: 450 }, (_, i) => ({
      path: ["s", `k${i}`], label: `K${i}`, kind: "number", value: i,
    }));
    net.apiGet.mockResolvedValueOnce(contents(many));
    await m.openFile("A".repeat(22));
    expect(m.shownSections.value.flatMap((s) => s.fields)).toHaveLength(200);
    expect(m.hiddenFieldCount.value).toBe(250);
    m.showMoreFields();
    expect(m.shownSections.value.flatMap((s) => s.fields)).toHaveLength(400);
  });

  it("requests the source text on demand", async () => {
    const m = useModConfigs();
    net.apiGet.mockResolvedValueOnce({ files: [] });
    await m.loadFiles("smp");
    net.apiGet.mockResolvedValueOnce(contents([{ path: ["k"], label: "K", kind: "string", value: "v" }]));
    await m.openFile("A".repeat(22));
    expect(m.current.value!.text).toBeUndefined();
    net.apiGet.mockResolvedValueOnce(contents([{ path: ["k"], label: "K", kind: "string", value: "v" }], { text: "src" }));
    await m.loadSource();
    expect(net.apiGet.mock.calls.at(-1)![0]).toContain("?text=1");
    expect(m.current.value!.text).toBe("src");
  });
});
