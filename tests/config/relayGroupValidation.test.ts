import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateCandidateConfig } from "../../src/core/config.js";

const servers = {
  a: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" },
  b: { apiUrl: "http://127.0.0.1:3031", apiKey: "k" },
};
const base = { token: "t", clientId: "c", servers };

const bridge = (server: string, relayGroup?: string) => ({
  channelId: "100000000000000001",
  server,
  ...(relayGroup ? { relayGroup } : {}),
});

const run = (guilds: object) => validateCandidateConfig({ ...base, guilds });
const plain = (lines: string[]): string => lines.join("\n");

describe("relay groups", () => {
  it("accepts two guilds relaying on the same server", () => {
    const r = run({
      "1": { bridgeLabel: "Alpha", chatBridge: bridge("a", "main") },
      "2": { bridgeLabel: "Beta", chatBridge: bridge("a", "main") },
    });
    expect(r.errors).toEqual([]);
    expect(plain(r.warnings)).not.toContain("relayGroup");
  });

  it("rejects a group whose bridges are bound to different servers", () => {
    const r = run({
      "1": { bridgeLabel: "Alpha", chatBridge: bridge("a", "main") },
      "2": { bridgeLabel: "Beta", chatBridge: bridge("b", "main") },
    });
    expect(r.valid).toBe(false);
    expect(plain(r.errors)).toContain('relayGroup "main" spans several servers (a, b)');
  });

  it("rejects a relay group on a bridge with no resolvable server", () => {
    const r = validateCandidateConfig({
      ...base,
      guilds: { "1": { chatBridge: { channelId: "100000000000000001", relayGroup: "main" } } },
    });
    expect(plain(r.errors)).toContain('relayGroup "main" needs a bridge bound to one server');
  });

  it("rejects a member that is not allowed to reach the group's server", () => {
    const r = run({
      "1": { bridgeLabel: "Alpha", chatBridge: bridge("a", "main") },
      "2": { bridgeLabel: "Beta", allowedServers: ["b"], chatBridge: bridge("a", "main") },
    });
    expect(plain(r.errors)).toContain("guilds.2.chatBridge");
    expect(plain(r.errors)).toContain("allowedServers does not include");
  });

  it("warns about a group with one member, a missing label and a shared label", () => {
    const alone = run({ "1": { bridgeLabel: "Alpha", chatBridge: bridge("a", "solo") } });
    expect(plain(alone.warnings)).toContain('relayGroup "solo" has only one Discord server');

    const unlabeled = run({
      "1": { chatBridge: bridge("a", "main") },
      "2": { bridgeLabel: "Beta", chatBridge: bridge("a", "main") },
    });
    expect(plain(unlabeled.warnings)).toContain("guilds.1.bridgeLabel is not set");

    const clash = run({
      "1": { bridgeLabel: "Same", chatBridge: bridge("a", "main") },
      "2": { bridgeLabel: "same", chatBridge: bridge("a", "main") },
    });
    expect(plain(clash.warnings)).toContain('share the label "same"');
  });

  it("ignores bridges without a relay group", () => {
    const r = run({
      "1": { chatBridge: bridge("a") },
      "2": { chatBridge: bridge("b") },
    });
    expect(plain(r.warnings)).not.toContain("relayGroup");
  });

  it("refuses a group name or label outside the schema limits", () => {
    const badGroup = run({ "1": { chatBridge: bridge("a", "Not Valid!") } });
    expect(badGroup.valid).toBe(false);
    const badLabel = run({ "1": { bridgeLabel: "x".repeat(25), chatBridge: bridge("a") } });
    expect(badLabel.valid).toBe(false);
  });
});
