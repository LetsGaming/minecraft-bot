import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({ language: "en", adminUsers: ["admin"], guilds: {} }),
}));
vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn(),
}));

import {
  confirmCustomId,
  createConfirmEmbed,
  createConfirmRow,
  parseConfirmCustomId,
  CONFIRM_TTL_MS,
} from "../../src/bot/utils/embeds/confirm.js";
import {
  confirmTarget,
  handleConfirmInteraction,
  registerConfirmAction,
} from "../../src/bot/interactions/confirmActions.js";
import { STATUS_TABLE } from "../../src/schema/status.js";

const NOW = 1_800_000_000_000;

function button(customId: string, userId = "admin") {
  return {
    customId,
    user: { id: userId },
    member: null,
    guild: null,
    deferred: false,
    replied: false,
    ephemeral: null,
    isButton: () => true,
    isChatInputCommand: () => false,
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("confirm custom ids", () => {
  it("round-trips through parse and stays under Discord's 100 characters", () => {
    const target = confirmTarget("server-stop", "survival", "123456789012345678", NOW);
    const id = confirmCustomId("yes", target);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(parseConfirmCustomId(id)).toEqual({ answer: "yes", ...target });
  });

  it("expires 60 seconds after creation", () => {
    expect(confirmTarget("a", "s", "u", NOW).expiresAt).toBe(NOW + CONFIRM_TTL_MS);
    expect(CONFIRM_TTL_MS).toBe(60_000);
  });

  it("ignores ids of other features", () => {
    expect(parseConfirmCustomId("hint:yes:daily:smp:1")).toBeNull();
    expect(parseConfirmCustomId("confirm:maybe:a:s:u:1")).toBeNull();
  });
});

describe("confirm builders", () => {
  it("is a pending embed with the expiry in the footer", () => {
    const json = createConfirmEmbed({ title: "Stop smp?", description: "3 players online." }).toJSON();
    expect(json.color).toBe(STATUS_TABLE.pending.embedColour);
    expect(json.footer?.text).toBe("The buttons expire in 60 s.");
  });

  it("is one danger button and Cancel", () => {
    const row = createConfirmRow(confirmTarget("server-stop", "smp", "u", NOW), "Stop smp").toJSON();
    expect(row.components).toHaveLength(2);
    const [yes, no] = row.components as { style: number; label: string; disabled?: boolean }[];
    expect(yes!.style).toBe(4);
    expect(yes!.label).toBe("Stop smp");
    expect(no!.label).toBe("Cancel");
  });
});

describe("handleConfirmInteraction", () => {
  const handler = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    handler.mockClear();
    registerConfirmAction("test-action", handler, { confirmLabelKey: "confirm.confirm" });
  });

  const id = (answer: "yes" | "no", userId = "admin") =>
    confirmCustomId(answer, confirmTarget("test-action", "smp", userId, NOW));

  it("runs the registered action for the invoker before expiry", async () => {
    const i = button(id("yes"));
    expect(await handleConfirmInteraction(i as never, NOW + 1_000)).toBe(true);
    expect(handler).toHaveBeenCalledWith(i, expect.objectContaining({ serverId: "smp" }));
  });

  it("refuses a press after the 60 second expiry and switches the row off", async () => {
    const i = button(id("yes"));
    await handleConfirmInteraction(i as never, NOW + CONFIRM_TTL_MS + 1);
    expect(handler).not.toHaveBeenCalled();
    const [[payload]] = i.update.mock.calls as [[{ components: { toJSON(): { components: { disabled?: boolean }[] } }[] }]];
    expect(payload.components[0]!.toJSON().components.every((c) => c.disabled)).toBe(true);
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it("refuses someone else's press", async () => {
    const i = button(id("yes", "admin"), "intruder");
    await handleConfirmInteraction(i as never, NOW);
    expect(handler).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
  });

  it("re-checks admin status at press time", async () => {
    const i = button(id("yes", "former-admin"), "former-admin");
    await handleConfirmInteraction(i as never, NOW);
    expect(handler).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalled();
  });

  it("cancels without running anything", async () => {
    const i = button(id("no"));
    await handleConfirmInteraction(i as never, NOW);
    expect(handler).not.toHaveBeenCalled();
    expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
  });

  it("leaves other buttons alone", async () => {
    const i = button("wlapp:approve:1");
    expect(await handleConfirmInteraction(i as never, NOW)).toBe(false);
  });
});
