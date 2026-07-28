/**
 * The structural half of config validation, now owned by the generated
 * JSON Schema. Covers what the hand-written checks used to do (types,
 * requiredness, bounds), the deliberate softenings (unknown keys warn,
 * unknown notification events warn), and the degradation path when the
 * generated schema is missing.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  checkAgainstSchema,
  formatInstancePath,
} from "../../src/core/configSchemaCheck.js";
import { validateCandidateConfig } from "../../src/core/config.js";

const srv = { apiUrl: "http://127.0.0.1:3030", apiKey: "k" };
const base = { token: "t", clientId: "c", servers: { a: srv } };

describe("formatInstancePath", () => {
  it("renders the root and nested paths", () => {
    expect(formatInstancePath("")).toBe("config root");
    expect(formatInstancePath("/guilds/1/notifications/events/0")).toBe(
      "guilds.1.notifications.events.0",
    );
  });

  it("decodes JSON-Pointer escapes", () => {
    expect(formatInstancePath("/servers/a~1b")).toBe("servers.a/b");
  });
});

describe("checkAgainstSchema", () => {
  it("accepts a minimal valid config", () => {
    const result = checkAgainstSchema(base);
    expect(result.errors).toEqual([]);
    expect(result.unavailable).toBe(false);
  });

  it("reports missing required fields by name", () => {
    const result = checkAgainstSchema({ token: "t", servers: { a: srv } });
    expect(result.errors.join("\n")).toContain("clientId: required");
  });

  it("reports a wrong type by name", () => {
    const result = checkAgainstSchema({ ...base, tpsWarningThreshold: "15" });
    expect(result.errors.join("\n")).toContain("tpsWarningThreshold");
    expect(result.errors.join("\n")).toContain("number");
  });

  it("enforces the numeric bounds the schema now carries", () => {
    // These were hand-written `if` checks before; the annotations on
    // RawBotConfig put them in the generated schema instead.
    expect(
      checkAgainstSchema({ ...base, tpsWarningThreshold: 0 }).errors.join("\n"),
    ).toContain("tpsWarningThreshold");
    expect(
      checkAgainstSchema({ ...base, tpsPollIntervalMs: 500 }).errors.join("\n"),
    ).toContain("tpsPollIntervalMs");
    expect(
      checkAgainstSchema({
        ...base,
        hostAlerts: { diskWarnPercent: 150 },
      }).errors.join("\n"),
    ).toContain("diskWarnPercent");
    expect(
      checkAgainstSchema({ ...base, limits: { slashWindowMs: 10 } }).errors.join(
        "\n",
      ),
    ).toContain("slashWindowMs");
  });

  it("reports nested paths, not just the top-level block", () => {
    const result = checkAgainstSchema({
      ...base,
      guilds: { "1": { notifications: { channelId: 5 } } },
    });
    expect(result.errors.join("\n")).toContain(
      "guilds.1.notifications.channelId",
    );
  });

  it("warns about unknown keys instead of refusing to boot", () => {
    const result = checkAgainstSchema({ ...base, futureOption: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toContain("futureOption");
  });

  it("ignores the editor's $schema key entirely", () => {
    const result = checkAgainstSchema({ ...base, $schema: "./x.json" });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).not.toContain("$schema");
  });
});

describe("validateCandidateConfig — structural + semantic together", () => {
  it("stops at structural errors rather than reporting meaning about a broken shape", () => {
    const result = validateCandidateConfig({
      token: "t",
      clientId: "c",
      servers: "not-an-object",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("servers");
    // The semantic pass (apiUrl transport, unknown-server refs) never ran.
    expect(result.errors.join("\n")).not.toContain("apiUrl:");
  });

  it("still runs the semantic checks on a structurally valid config", () => {
    const result = validateCandidateConfig({
      ...base,
      guilds: { "1": { defaultServer: "ghost" } },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain('unknown server "ghost"');
  });

  it("treats an unknown notification event as a warning, not a boot failure", () => {
    const result = validateCandidateConfig({
      ...base,
      guilds: { "1": { notifications: { channelId: "c1", events: ["nope"] } } },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("unknown event");
  });

  it("keeps the 4.x migration message rather than a bare required error", () => {
    const result = validateCandidateConfig({
      token: "t",
      clientId: "c",
      serverDir: "/opt/mc",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("migrating-to-5");
  });

  it("keeps the checks a JSON Schema cannot express", () => {
    // Port range + integer-ness, HH:MM, positive thresholds.
    expect(
      validateCandidateConfig({ ...base, webui: { port: 70000 } }).errors.join(
        "\n",
      ),
    ).toContain("webui.port");
    expect(
      validateCandidateConfig({
        ...base,
        schedules: { a: { restart: { time: "25:00" } } },
      }).errors.join("\n"),
    ).toContain("restart.time");
    expect(
      validateCandidateConfig({
        ...base,
        milestones: { "minecraft:mined": [10, -5] },
      }).errors.join("\n"),
    ).toContain("milestones");
  });
});
