import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../../src/web/frontend/src/api.js";
import {
  useEditableDocument,
  type EditableSource,
} from "../../src/web/frontend/src/composables/useEditableDocument.js";
import {
  hasUnsavedChanges,
  confirmLeave,
  clearDirtySources,
} from "../../src/web/frontend/src/composables/useUnsavedGuard.js";

interface Doc extends Record<string, unknown> {
  name?: string;
  limits?: { max: number };
  tags?: string[];
}

/** A tiny in-memory "server" with a token that moves on every write. */
function server(initial: Doc) {
  let doc: Doc = JSON.parse(JSON.stringify(initial));
  let version = 1;
  const saves: { token: string; changes: unknown }[] = [];
  const source: EditableSource<Doc, { extra: number }> = {
    load: vi.fn(async () => ({
      doc: JSON.parse(JSON.stringify(doc)) as Doc,
      token: `v${version}`,
      meta: { extra: version },
    })),
    save: vi.fn(async ({ token, draft, changes }) => {
      saves.push({ token, changes });
      if (token !== `v${version}`) {
        throw new ApiError(409, "changed", "CONFLICT", { currentHash: `v${version}` });
      }
      doc = JSON.parse(JSON.stringify(draft));
      version += 1;
      return { warnings: ["heads up"] };
    }),
  };
  return {
    source,
    saves,
    external(next: Doc) {
      doc = next;
      version += 1;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
});

describe("useEditableDocument loading", () => {
  it("loads, tracks loading, and exposes meta", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    expect(ed.ready.value).toBe(false);
    const p = ed.load();
    expect(ed.loading.value).toBe(true);
    await p;
    expect(ed.loading.value).toBe(false);
    expect(ed.ready.value).toBe(true);
    expect(ed.meta.value).toEqual({ extra: 1 });
    expect(ed.dirty.value).toBe(false);
  });

  it("reports a load failure, stays unusable, and recovers on retry", async () => {
    const s = server({ name: "a" });
    vi.mocked(s.source.load).mockRejectedValueOnce(new ApiError(500, "boom"));
    const ed = useEditableDocument(s.source);
    expect(await ed.load()).toBe(false);
    expect(ed.loadError.value).toBe("boom");
    expect(ed.ready.value).toBe(false);
    expect(await ed.save()).toBe(false);
    expect(s.source.save).not.toHaveBeenCalled();

    expect(await ed.load()).toBe(true);
    expect(ed.loadError.value).toBe("");
    expect(ed.ready.value).toBe(true);
  });
});

describe("useEditableDocument dirty tracking", () => {
  it("marks only the touched fields and clears them when set back", async () => {
    const ed = useEditableDocument(server({ name: "a", tags: ["x"] }).source);
    await ed.load();
    ed.setField("name", "b");
    expect(ed.dirty.value).toBe(true);
    expect(ed.isDirty("name")).toBe(true);
    expect(ed.isDirty("tags")).toBe(false);
    ed.setField("name", "a");
    expect(ed.dirty.value).toBe(false);
  });

  it("notices nested edits made straight on the draft", async () => {
    const ed = useEditableDocument(server({ limits: { max: 1 } }).source);
    await ed.load();
    ed.draft.value!.limits!.max = 2;
    expect(ed.dirtyKeys.value).toEqual(["limits"]);
  });

  it("builds a change-only payload, with removals separate", async () => {
    const ed = useEditableDocument(
      server({ name: "a", tags: ["x"], limits: { max: 1 } }).source,
    );
    await ed.load();
    ed.setField("name", "b");
    ed.setField("tags", undefined);
    expect(ed.changes.value).toEqual({ set: { name: "b" }, remove: ["tags"] });
  });

  it("discard restores the baseline", async () => {
    const ed = useEditableDocument(server({ name: "a" }).source);
    await ed.load();
    ed.setField("name", "b");
    ed.discard();
    expect(ed.draft.value).toEqual({ name: "a" });
    expect(ed.dirty.value).toBe(false);
  });
});

describe("useEditableDocument saving", () => {
  it("sends the load-time token and only the changes, then re-reads", async () => {
    const s = server({ name: "a", tags: ["x"] });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "b");
    expect(await ed.save()).toBe(true);

    expect(s.saves).toEqual([{ token: "v1", changes: { set: { name: "b" }, remove: [] } }]);
    expect(s.source.load).toHaveBeenCalledTimes(2);
    expect(ed.token.value).toBe("v2");
    expect(ed.dirty.value).toBe(false);
    expect(ed.saved.value).toBe(true);
    expect(ed.warnings.value).toEqual(["heads up"]);

    ed.setField("name", "c");
    expect(ed.saved.value).toBe(false);
  });

  it("does not save, and does not call the server, when nothing changed", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    expect(await ed.save()).toBe(false);
    expect(s.source.save).not.toHaveBeenCalled();
    expect(ed.saved.value).toBe(false);
  });

  it("never refetches the token between load and save", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "b");
    s.external({ name: "other" });
    vi.mocked(s.source.load).mockClear();
    await ed.save();
    expect(s.saves[0]!.token).toBe("v1");
  });

  it("surfaces validation errors as a list and keeps the edits", async () => {
    const s = server({ name: "a" });
    vi.mocked(s.source.save).mockRejectedValueOnce(
      new ApiError(422, "Validation failed", "VALIDATION_FAILED", {
        errors: ["  - name: bad"],
      }),
    );
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "b");
    expect(await ed.save()).toBe(false);
    expect(ed.fieldErrors.value).toEqual(["  - name: bad"]);
    expect(ed.draft.value).toEqual({ name: "b" });
    expect(ed.dirty.value).toBe(true);
  });

  it("keeps a plain failure message", async () => {
    const s = server({ name: "a" });
    vi.mocked(s.source.save).mockRejectedValueOnce(new ApiError(500, "disk full"));
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "b");
    await ed.save();
    expect(ed.saveError.value).toBe("disk full");
  });

  it("refuses to save again when the confirming re-read failed", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "b");
    vi.mocked(s.source.load).mockRejectedValueOnce(new ApiError(500, "gone"));
    expect(await ed.save()).toBe(true);
    expect(ed.stale.value).toBe(true);
    expect(ed.dirty.value).toBe(false);
    ed.setField("name", "c");
    expect(await ed.save()).toBe(false);
    expect(s.source.save).toHaveBeenCalledTimes(1);
  });
});

describe("useEditableDocument conflicts", () => {
  it("keeps the user's edits on a 409 and adopts non-overlapping server changes", async () => {
    const s = server({ name: "a", tags: ["x"], limits: { max: 1 } });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "a", tags: ["x", "y"], limits: { max: 1 } });

    expect(await ed.save()).toBe(false);
    expect(ed.conflicts.value).toEqual([]);
    expect(ed.draft.value).toEqual({ name: "mine", tags: ["x", "y"], limits: { max: 1 } });
    expect(ed.token.value).toBe("v2");
    expect(ed.isDirty("name")).toBe(true);
    expect(ed.isDirty("tags")).toBe(false);

    expect(await ed.save()).toBe(true);
    expect(s.saves.at(-1)!.token).toBe("v2");
  });

  it("raises a conflict for fields both sides changed, and blocks saving until resolved", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "theirs" });

    expect(await ed.save()).toBe(false);
    expect(ed.conflicts.value).toHaveLength(1);
    expect(ed.conflicts.value[0]).toMatchObject({
      queued: "mine",
      base: "a",
      current: "theirs",
    });
    expect(ed.draft.value).toEqual({ name: "mine" });

    expect(await ed.save()).toBe(false);
    expect(s.source.save).toHaveBeenCalledTimes(1);
  });

  it("keep mine saves the user's value on top of the new token", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "theirs" });
    await ed.save();
    ed.resolveConflict(ed.conflicts.value[0]!, "queued");
    expect(ed.conflicts.value).toEqual([]);
    expect(await ed.save()).toBe(true);
    expect(ed.draft.value).toEqual({ name: "mine" });
    expect(s.saves.at(-1)!.token).toBe("v2");
  });

  it("keep the server's value drops the user's edit for that field", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "theirs" });
    await ed.save();
    ed.resolveConflict(ed.conflicts.value[0]!, "current");
    expect(ed.draft.value).toEqual({ name: "theirs" });
    expect(ed.dirty.value).toBe(false);
  });

  it("reloadDiscardingMine takes the server's version", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "theirs" });
    await ed.save();
    await ed.reloadDiscardingMine();
    expect(ed.draft.value).toEqual({ name: "theirs" });
    expect(ed.conflicts.value).toEqual([]);
  });

  it("keeps the edits when the latest version cannot be loaded after a 409", async () => {
    const s = server({ name: "a" });
    const ed = useEditableDocument(s.source);
    await ed.load();
    ed.setField("name", "mine");
    s.external({ name: "theirs" });
    vi.mocked(s.source.load).mockRejectedValueOnce(new ApiError(503, "down"));
    expect(await ed.save()).toBe(false);
    expect(ed.draft.value).toEqual({ name: "mine" });
    expect(ed.saveError.value).toContain("down");
  });
});

describe("useEditableDocument custom units", () => {
  it("tracks and merges at the granularity the document supplies", async () => {
    type Overrides = { global: Record<string, { enabled?: boolean }> };
    let remote: Overrides = {
      global: { ping: { enabled: true }, stats: { enabled: true } },
    };
    let version = 1;
    const units = {
      read: (d: Overrides) =>
        Object.fromEntries(Object.entries(d.global).map(([k, v]) => [`global.${k}`, v])),
      write: (d: Overrides, key: string, value: unknown) => {
        const name = key.slice("global.".length);
        if (value === undefined) delete d.global[name];
        else d.global[name] = value as { enabled?: boolean };
      },
    };
    const source: EditableSource<Overrides, never> = {
      load: async () => ({ doc: JSON.parse(JSON.stringify(remote)), token: `v${version}` }),
      save: async ({ token, draft }) => {
        if (token !== `v${version}`) throw new ApiError(409, "x", "CONFLICT");
        remote = draft;
        version += 1;
      },
    };
    const ed = useEditableDocument(source, { units });
    await ed.load();
    ed.setField("global.ping", { enabled: false });
    expect(ed.dirtyKeys.value).toEqual(["global.ping"]);

    remote = { global: { ping: { enabled: true }, stats: { enabled: false } } };
    version += 1;
    await ed.save();
    expect(ed.conflicts.value).toEqual([]);
    expect(ed.draft.value).toEqual({
      global: { ping: { enabled: false }, stats: { enabled: false } },
    });
  });
});

describe("unsaved guard", () => {
  it("reports dirty documents and asks before leaving", async () => {
    const ed = useEditableDocument(server({ name: "a" }).source);
    await ed.load();
    expect(hasUnsavedChanges()).toBe(false);
    ed.setField("name", "b");
    expect(hasUnsavedChanges()).toBe(true);

    const ask = vi.fn(async () => false);
    expect(await confirmLeave(ask)).toBe(false);
    ed.discard();
    expect(hasUnsavedChanges()).toBe(false);
    expect(await confirmLeave(ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
