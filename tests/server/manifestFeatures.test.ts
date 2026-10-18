import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  featureAtLeast,
  forgetAdvertisedScriptTimeouts,
  getAdvertisedScriptTimeouts,
  getRemoteManifest,
} from "../../src/core/utils/server/access/manifest.js";
import {
  supportsLifecycleEvents,
  supportsUpgrade,
} from "../../src/core/utils/server/access/upgrade.js";
import { supportsModCompat } from "../../src/core/utils/server/access/modCompat.js";
import { supportsPrune } from "../../src/core/utils/server/access/prune.js";
import { resetBreakersForTesting } from "../../src/core/utils/server/circuitBreaker.js";
import { invalidatePrefix } from "../../src/core/utils/cache.js";

const cfg = { id: "smp", apiUrl: "https://wrapper.example.com", apiKey: "k" } as never;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function manifest(features: Record<string, number>, extra: Record<string, unknown> = {}) {
  return {
    wrapper: "4.0.0",
    manifest: 1,
    routes: [],
    scriptActions: [],
    features: Object.fromEntries(
      Object.entries(features).map(([name, version]) => [name, { version, summary: "" }]),
    ),
    ...extra,
  };
}

/** Manifest on /manifest, capabilities on /capabilities. */
function serve(features: Record<string, number>, capabilities: Record<string, unknown> = {}) {
  mockFetch.mockImplementation(async (url: string) =>
    String(url).endsWith("/manifest")
      ? json(200, manifest(features))
      : json(200, { scripts: {}, backups: true, restore: true, modManifest: true, variablesFile: true, ...capabilities }),
  );
}

const manifestCalls = (): number =>
  mockFetch.mock.calls.filter(([url]) => String(url).endsWith("/manifest")).length;

beforeEach(() => {
  mockFetch.mockReset();
  resetBreakersForTesting();
  invalidatePrefix("manifest:");
  forgetAdvertisedScriptTimeouts(cfg);
});

describe("featureAtLeast", () => {
  it("compares the advertised feature version", async () => {
    serve({ operations: 2 });
    expect(await featureAtLeast(cfg, "operations", 1)).toBe(true);
    expect(await featureAtLeast(cfg, "operations", 2)).toBe(true);
    expect(await featureAtLeast(cfg, "operations", 3)).toBe(false);
  });

  it("is false for a feature the wrapper does not advertise or cannot be asked about", async () => {
    serve({});
    expect(await featureAtLeast(cfg, "operations", 1)).toBe(false);
    invalidatePrefix("manifest:");
    mockFetch.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await featureAtLeast(cfg, "operations", 1)).toBe(false);
  });

  it("asks the wrapper once for every supports* check", async () => {
    serve({ operations: 1, "lifecycle-events": 1, "chunk-prune": 1, "mod-compat": 1 });
    expect(await supportsUpgrade(cfg)).toBe(true);
    expect(await supportsLifecycleEvents(cfg)).toBe(true);
    expect(await supportsPrune(cfg)).toBe(true);
    expect(await supportsModCompat(cfg)).toBe(true);
    expect(manifestCalls()).toBe(1);
  });

  it("keeps upgrade and prune behind the setup suite's script", async () => {
    serve({ operations: 1, "chunk-prune": 1 }, { upgrade: false, prune: false });
    expect(await supportsUpgrade(cfg)).toBe(false);
    expect(await supportsPrune(cfg)).toBe(false);
  });

  it("does not cache a failed manifest fetch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await supportsLifecycleEvents(cfg)).toBe(false);
    serve({ "lifecycle-events": 1 });
    expect(await supportsLifecycleEvents(cfg)).toBe(true);
  });
});

describe("advertised script timeouts", () => {
  it("are stored per wrapper, including an action the bot has no fallback for", async () => {
    mockFetch.mockResolvedValueOnce(
      json(200, manifest({}, { scriptTimeoutsMs: { stop: 900_000, prune: 120_000 } })),
    );
    await getRemoteManifest(cfg);
    expect(getAdvertisedScriptTimeouts(cfg)).toEqual({ stop: 900_000, prune: 120_000 });
  });

  it("are dropped when the next manifest no longer advertises them, or on request", async () => {
    mockFetch.mockResolvedValueOnce(json(200, manifest({}, { scriptTimeoutsMs: { stop: 900_000 } })));
    await getRemoteManifest(cfg);
    mockFetch.mockResolvedValueOnce(json(200, manifest({})));
    await getRemoteManifest(cfg);
    expect(getAdvertisedScriptTimeouts(cfg)).toBeUndefined();

    mockFetch.mockResolvedValueOnce(json(200, manifest({}, { scriptTimeoutsMs: { stop: 900_000 } })));
    await getRemoteManifest(cfg);
    forgetAdvertisedScriptTimeouts(cfg);
    expect(getAdvertisedScriptTimeouts(cfg)).toBeUndefined();
  });
});
