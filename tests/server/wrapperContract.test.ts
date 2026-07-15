/**
 * The wrapper feature contract.
 *
 * The bug these guard against is a quiet one: every wrapper call degrades
 * on its own, so an outdated wrapper and a healthy one look identical from
 * the outside. The old check was a single semver compare against
 * MIN_WRAPPER_VERSION — which was set to 1.2.0, a version that never had
 * `/info` at all (it shipped in wrapper 3.0.0), so the comparison could
 * never fail and the mechanism was dead. These tests assert the
 * replacement actually reports both sides being behind.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  MIN_WRAPPER_VERSION,
  SUPPORTED_MANIFEST_VERSION,
  EXPECTED_WRAPPER_FEATURES,
  parseManifest,
  compareContract,
  contractIsClean,
  describeContract,
  logContractReport,
  type WrapperManifest,
} from "../../src/core/utils/server/wrapperContract.js";
import { log } from "../../src/core/utils/logger.js";

/** A manifest exactly matching what this bot expects. */
function goodManifest(): WrapperManifest {
  const features: WrapperManifest["features"] = {};
  for (const [name, spec] of Object.entries(EXPECTED_WRAPPER_FEATURES)) {
    features[name] = { version: spec.version, summary: `${name} summary` };
  }
  return {
    wrapper: "3.1.0",
    manifest: SUPPORTED_MANIFEST_VERSION,
    routes: ["GET /manifest"],
    features,
    scriptActions: ["backup", "restart", "start", "status", "stop"],
  };
}

describe("MIN_WRAPPER_VERSION", () => {
  it("names the release that actually introduced /info", () => {
    // Wrapper 3.0.0 added /info, /usercache, and the capabilities
    // contract. 1.2.0 was the version the bot predicted /info would land
    // in; it never existed with that endpoint, so the constant asserted
    // something untrue and its comparison was unreachable.
    expect(MIN_WRAPPER_VERSION).toBe("3.0.0");
  });
});

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(goodManifest())).not.toBeNull();
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["missing wrapper version", { manifest: 1, routes: [], features: {}, scriptActions: [] }],
    ["non-numeric envelope", { wrapper: "3.0.0", manifest: "1", routes: [], features: {}, scriptActions: [] }],
    ["routes not strings", { wrapper: "3.0.0", manifest: 1, routes: [1], features: {}, scriptActions: [] }],
    ["feature without a version", { wrapper: "3.0.0", manifest: 1, routes: [], features: { a: {} }, scriptActions: [] }],
  ])("rejects %s", (_label, body) => {
    expect(parseManifest(body)).toBeNull();
  });

  it("tolerates a missing summary — it is prose, not contract", () => {
    const parsed = parseManifest({
      wrapper: "3.0.0",
      manifest: 1,
      routes: [],
      features: { usercache: { version: 1 } },
      scriptActions: [],
    });
    expect(parsed?.features.usercache).toEqual({ version: 1, summary: "" });
  });
});

describe("compareContract", () => {
  it("reports nothing when the wrapper matches", () => {
    const report = compareContract(goodManifest());
    expect(contractIsClean(report)).toBe(true);
  });

  it("names each feature the wrapper lacks, and what it costs", () => {
    const m = goodManifest();
    delete m.features.usercache;
    delete m.features["log-stream"];

    const report = compareContract(m);
    expect(report.missing.map((f) => f.name).sort()).toEqual([
      "log-stream",
      "usercache",
    ]);
    // The report has to say what breaks — "wrapper is old" is not actionable.
    expect(report.missing.every((f) => f.degrades.length > 0)).toBe(true);
  });

  it("flags a wrapper feature older than the bot expects", () => {
    const m = goodManifest();
    m.features["host-info"] = { version: 0, summary: "old" };

    const report = compareContract(m);
    expect(report.outdated).toEqual([
      {
        name: "host-info",
        want: 1,
        have: 0,
        degrades: EXPECTED_WRAPPER_FEATURES["host-info"]!.degrades,
      },
    ]);
  });

  it("flags a wrapper feature NEWER than the bot reads — the bot is behind", () => {
    const m = goodManifest();
    m.features.capabilities = { version: 99, summary: "new shape" };

    const report = compareContract(m);
    expect(report.ahead).toEqual([{ name: "capabilities", want: 1, have: 99 }]);
  });

  it("reports features the wrapper offers that this bot never uses", () => {
    const m = goodManifest();
    m.features["backup-prune"] = { version: 1, summary: "Prune old backups." };

    const report = compareContract(m);
    expect(report.unused).toEqual([
      { name: "backup-prune", summary: "Prune old backups." },
    ]);
    // Nothing is missing — the wrapper is ahead, not behind.
    expect(report.missing).toEqual([]);
  });
});

describe("describeContract", () => {
  it("tells the operator to update the wrapper when it is behind", () => {
    const m = goodManifest();
    delete m.features.usercache;
    const lines = describeContract(m, compareContract(m), "4.3.0");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("usercache");
    expect(lines[0]).toContain("Update the wrapper");
  });

  it("tells the operator to update the BOT when the wrapper is ahead", () => {
    const m = goodManifest();
    m.features["future-thing"] = { version: 1, summary: "Something new." };
    const lines = describeContract(m, compareContract(m), "4.3.0");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("future-thing");
    expect(lines[0]).toContain("Update the bot");
  });
});

describe("logContractReport", () => {
  it("stays quiet on a matching wrapper", () => {
    vi.mocked(log.warn).mockClear();
    const m = goodManifest();
    logContractReport("smp", m, compareContract(m), "4.3.0");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns per gap, under the instance's tag", () => {
    vi.mocked(log.warn).mockClear();
    const m = goodManifest();
    delete m.features.mods;
    delete m.features.backups;
    logContractReport("smp", m, compareContract(m), "4.3.0");
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(log.warn).mock.calls.every((c) => c[0] === "smp")).toBe(true);
  });

  it("warns when the manifest envelope is newer than this bot reads", () => {
    vi.mocked(log.warn).mockClear();
    const m = goodManifest();
    m.manifest = SUPPORTED_MANIFEST_VERSION + 1;
    logContractReport("smp", m, compareContract(m), "4.3.0");
    // Envelope warning fires, and the features it *could* read still pass.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![1]).toContain("manifest");
  });
});
