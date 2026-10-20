import { describe, it, expect } from "vitest";

import {
  buildGuildBlock,
  seedModel,
} from "../../src/web/frontend/src/composables/useGuildSetup.js";

const existing = {
  defaultServer: "smp",
  bridgeLabel: "Alpha",
  chatBridge: { channelId: "100000000000000001", useWebhook: true, relayGroup: "main" },
};

describe("setup wizard relay settings", () => {
  it("shows the label and the relay group of an existing bridge", () => {
    const m = seedModel(existing).chatBridge!;
    expect(m.bridgeLabel).toBe("Alpha");
    expect(m.relayGroup).toBe("main");
  });

  it("writes the label and keeps the relay group it did not ask about", () => {
    const model = seedModel(existing);
    model.chatBridge!.bridgeLabel = "  Beta  ";
    const block = buildGuildBlock(existing, model, "smp");
    expect(block.bridgeLabel).toBe("Beta");
    expect(block.chatBridge).toEqual({ channelId: "100000000000000001", useWebhook: true, relayGroup: "main" });
  });

  it("drops the label when it is cleared", () => {
    const model = seedModel(existing);
    model.chatBridge!.bridgeLabel = " ";
    expect(buildGuildBlock(existing, model, "smp")).not.toHaveProperty("bridgeLabel");
  });

  it("leaves a guild without a chat bridge alone", () => {
    const block = buildGuildBlock({ defaultServer: "smp" }, seedModel({ defaultServer: "smp" }), "smp");
    expect(block).not.toHaveProperty("bridgeLabel");
    expect(block).not.toHaveProperty("chatBridge");
  });
});
