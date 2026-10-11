/**
 * Snapshot of a whitelist application: the post in the admin queue and the
 * applicant's confirmation, through the real modal handler and embed
 * builders, for an English and a German guild.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { GUILD, LANGUAGES, NOW, fixturePath, renderMessage, stringify } from "./render.js";

const config = vi.hoisted(() => {
  const app = { channelId: "apply-ch", adminChannelId: "admin-ch", mentionRole: "role-admins" };
  return {
    language: "en",
    adminUsers: ["admin-1"],
    guilds: {
      "g-en": { language: "en", whitelistApplications: app },
      "g-de": { language: "de", whitelistApplications: app },
    },
  };
});
vi.mock("../../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => config,
  getServerIds: () => ["smp"],
}));
vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/core/utils/server/guildTargets.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveDefaultServerId: vi.fn().mockReturnValue("smp"),
  visibleServerIdsForGuild: vi.fn().mockReturnValue(["smp"]),
}));

import { handleWhitelistApplicationInteraction } from "../../../src/bot/interactions/whitelistApplications.js";
import { closeDbForTesting } from "../../../src/core/db/index.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("Discord snapshots: whitelist application", () => {
  it("queue post and applicant reply", async () => {
    const out: Record<string, unknown> = {};
    for (const language of LANGUAGES) {
      closeDbForTesting();
      const sent: Array<Record<string, unknown>> = [];
      const interaction = {
        isButton: () => false,
        isModalSubmit: () => true,
        customId: "wlapp:modal",
        guild: { id: GUILD[language] },
        user: { id: "player-1", tag: "nils_builds" },
        client: {
          channels: {
            fetch: async () => ({
              send: async (p: unknown) => void sent.push(renderMessage("admin queue", p)),
            }),
          },
        },
        deferReply: async () => undefined,
        editReply: async (p: unknown) => void sent.push(renderMessage("editReply", p)),
        fields: {
          getTextInputValue: (k: string) =>
            k === "mcName"
              ? "Nils_Builds"
              : "Marlene's cousin. I build big redstone farms and have been on the Discord for 3 weeks.",
          getStringSelectValues: () => [],
        },
      };
      await handleWhitelistApplicationInteraction(interaction as never);
      // Application ids in the button customIds are random.
      out[language] = sent.map((m) => {
        const components = m.components as Array<Array<Record<string, unknown>>> | undefined;
        if (!components) return m;
        return {
          ...m,
          components: components.map((row) => row.map(({ customId: _id, ...button }) => button)),
        };
      });
    }
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("whitelist-application"));
  });
});
