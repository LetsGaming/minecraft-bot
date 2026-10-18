/** The save rules shared by a live write and a queued one. */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  indexConfigFiles: vi.fn(),
  readConfigFile: vi.fn(),
  writeConfigFile: vi.fn(),
  revertConfigFile: vi.fn(),
  wrapperFeatureVersion: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/queuedEdits.js", () => ({
  queueEdits: vi.fn(),
  pendingForServer: vi.fn(),
  dropForFile: vi.fn(),
  rebaseEdit: vi.fn(),
  dropEditByKey: vi.fn(),
}));
vi.mock("../../src/core/utils/wrapper/queueFlush.js", () => ({
  flushQueuedEdits: vi.fn(),
  previewQueuedEdits: vi.fn(),
}));

import { assertWritable, type ConfigSnapshot } from "../../src/web/backend/routes/modConfigs.js";

const TOML = `[general]
	#Range: 1 ~ 64
	maxSpawnCount = 8
`;

function snapshot(over: Partial<ConfigSnapshot["file"]> = {}, relPath = "config/jei.toml"): ConfigSnapshot {
  return { file: { relPath, ...over }, text: TOML, etag: "e1" };
}

const edit = [{ path: ["general", "maxSpawnCount"], value: 3 }];

describe("assertWritable", () => {
  it("returns the spliced text and the parse it was based on", () => {
    const { next, parsed } = assertWritable(snapshot(), edit, "e1", false);
    expect(next).toContain("maxSpawnCount = 3");
    expect(parsed.nodes.length).toBeGreaterThan(0);
  });

  it("refuses an edit made against an older version with a 409", () => {
    expect(() => assertWritable(snapshot(), edit, "older", false)).toThrowError(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it("refuses a secret-bearing file to a caller who may not touch it, and allows it otherwise", () => {
    const props = snapshot({}, "server.properties");
    props.text = "rcon.password=hunter2\n";
    const plugin = snapshot({}, "plugins/x/config.toml");
    for (const secret of [props, plugin]) {
      expect(() => assertWritable(secret, edit, "e1", false)).toThrowError(
        expect.objectContaining({ statusCode: 403 }),
      );
    }
    expect(() => assertWritable(plugin, edit, "e1", true)).not.toThrow();
  });

  it("refuses a file marked read-only", () => {
    expect(() => assertWritable(snapshot({ editable: false }), edit, "e1", false)).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("turns an edit that does not apply into a 400", () => {
    expect(() =>
      assertWritable(snapshot(), [{ path: ["no", "such", "key"], value: 1 }], "e1", false),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });
});
