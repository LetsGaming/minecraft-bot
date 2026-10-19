/**
 * Characterization tests for the whitelist application flow: the persistent
 * Apply prompt, the modal submit (validation, server selection, spam guard,
 * queue post) and the Approve/Deny buttons (admin gate, stale buttons,
 * approval failures, applicant DM).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockConfig = vi.hoisted(() => ({
  guilds: {} as Record<string, unknown>,
  serverIds: ["survival"] as string[],
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({ guilds: mockConfig.guilds }),
  getServerIds: () => mockConfig.serverIds,
}));

const guildTargets = vi.hoisted(() => ({
  resolveDefaultServerId: vi.fn(),
  visibleServerIdsForGuild: vi.fn(),
}));
vi.mock("../../src/core/utils/server/guildTargets.js", () => guildTargets);

const getGuildScopedServer = vi.fn();
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  getGuildScopedServer: (...a: unknown[]) => getGuildScopedServer(...a) as unknown,
}));

const isInvokerAdmin = vi.fn();
vi.mock("../../src/bot/utils/guild/permissions.js", () => ({
  isInvokerAdmin: (...a: unknown[]) => isInvokerAdmin(...a) as unknown,
}));

const performWhitelistAdd = vi.fn();
vi.mock("../../src/bot/commands/shared/whitelistAdd.js", () => ({
  performWhitelistAdd: (...a: unknown[]) => performWhitelistAdd(...a) as unknown,
}));

const recordAdminAction = vi.fn();
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: (e: unknown) => recordAdminAction(e) as unknown,
}));

import {
  ensureApplicationPrompts,
  handleWhitelistApplicationInteraction,
  type WhitelistApplication,
} from "../../src/bot/interactions/whitelistApplications.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { CLAIM_TTL_MS } from "../../src/core/utils/stores/whitelistApplicationStore.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import type { Client, Interaction } from "discord.js";

const GUILD = "g1";
const GUILD_CFG = {
  whitelistApplications: {
    channelId: "apply-ch",
    adminChannelId: "admin-ch",
    mentionRole: "role-9",
  },
};

interface Store {
  prompts: Record<string, { channelId: string; messageId: string }>;
  applications: WhitelistApplication[];
}
function store(): Store {
  return kvGet<Store>("whitelistApplications") as Store;
}
function seedApp(overrides: Partial<WhitelistApplication> = {}): WhitelistApplication {
  const app: WhitelistApplication = {
    id: "abcd1234",
    guildId: GUILD,
    userId: "u1",
    userTag: "user#1",
    mcName: "Steve",
    serverId: "survival",
    status: "pending",
    createdAt: 1000,
    ...overrides,
  };
  const cur = kvGet<Store>("whitelistApplications") ?? { prompts: {}, applications: [] };
  kvSet("whitelistApplications", {
    version: 1,
    prompts: cur.prompts,
    applications: [...cur.applications, app],
  });
  return app;
}

const queueSend = vi.fn();
const dmSend = vi.fn();
function makeClient(opts: { channel?: unknown } = {}) {
  const channel = "channel" in opts ? opts.channel : { send: queueSend };
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    users: { fetch: vi.fn().mockResolvedValue({ send: dmSend }) },
  };
}

function modalInteraction(
  fields: { mcName: string; note?: string; server?: string | null },
  client = makeClient(),
  guildId: string | null = GUILD,
) {
  return {
    isButton: () => false,
    isModalSubmit: () => true,
    customId: "wlapp:modal",
    guild: guildId ? { id: guildId } : null,
    user: { id: "u1", tag: "user#1" },
    client,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    fields: {
      getTextInputValue: (k: string) =>
        k === "mcName" ? fields.mcName : (fields.note ?? ""),
      getStringSelectValues: (k: string) => {
        if (k !== "server" || fields.server === undefined) throw new Error("no field");
        return fields.server === null ? [] : [fields.server];
      },
    },
  };
}

function buttonInteraction(customId: string, client = makeClient()) {
  return {
    isButton: () => true,
    isModalSubmit: () => false,
    customId,
    guild: { id: GUILD },
    user: { id: "admin1", tag: "admin#1" },
    client,
    reply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

const handle = (i: unknown) =>
  handleWhitelistApplicationInteraction(i as Interaction);

beforeEach(() => {
  closeDbForTesting();
  vi.clearAllMocks();
  mockConfig.guilds = { [GUILD]: GUILD_CFG };
  mockConfig.serverIds = ["survival"];
  guildTargets.resolveDefaultServerId.mockReset().mockReturnValue("survival");
  guildTargets.visibleServerIdsForGuild.mockReset().mockReturnValue(["survival"]);
  isInvokerAdmin.mockReset().mockReturnValue(true);
  performWhitelistAdd.mockReset().mockResolvedValue({ name: "Steve" });
  recordAdminAction.mockReset().mockResolvedValue(undefined);
  getGuildScopedServer.mockReset().mockReturnValue({ id: "survival" });
  queueSend.mockReset().mockResolvedValue({ id: "msg-1" });
  dmSend.mockReset().mockResolvedValue(undefined);
});

describe("handleWhitelistApplicationInteraction routing", () => {
  it("ignores buttons and modals that are not wlapp components", async () => {
    expect(await handle(buttonInteraction("other:thing"))).toBe(false);
    expect(
      await handle({ isButton: () => false, isModalSubmit: () => true, customId: "x" }),
    ).toBe(false);
    expect(
      await handle({ isButton: () => false, isModalSubmit: () => false }),
    ).toBe(false);
  });

  it("claims the apply button and shows a modal without a server picker when a default exists", async () => {
    const i = buttonInteraction("wlapp:apply");
    expect(await handle(i)).toBe(true);
    const modal = (i.showModal.mock.calls[0]![0] as { toJSON(): { components: unknown[] } }).toJSON();
    expect(modal.components).toHaveLength(2);
  });

  it("builds a German modal whose strings fit Discord limits", async () => {
    mockConfig.guilds = { [GUILD]: { ...GUILD_CFG, language: "de" } };
    guildTargets.resolveDefaultServerId.mockImplementation(() => {
      throw new Error("ambiguous");
    });
    guildTargets.visibleServerIdsForGuild.mockReturnValue(["a", "b"]);
    const i = buttonInteraction("wlapp:apply");
    await handle(i);
    const modal = (
      i.showModal.mock.calls[0]![0] as {
        toJSON(): {
          title: string;
          components: Array<{ label: string }>;
        };
      }
    ).toJSON();
    expect(modal.title.length).toBeLessThanOrEqual(45);
    expect(modal.components).toHaveLength(3);
    for (const c of modal.components) {
      expect(c.label.length).toBeLessThanOrEqual(45);
    }
    expect(modal.components[2]!.label).toBe("Hinweis für die Admins (optional)");
  });

  it("adds a server picker when the guild has no unambiguous default", async () => {
    guildTargets.resolveDefaultServerId.mockImplementation(() => {
      throw new Error("ambiguous");
    });
    guildTargets.visibleServerIdsForGuild.mockReturnValue(["a", "b"]);
    const i = buttonInteraction("wlapp:apply");
    await handle(i);
    const modal = (i.showModal.mock.calls[0]![0] as { toJSON(): { components: unknown[] } }).toJSON();
    expect(modal.components).toHaveLength(3);
  });

  it("does nothing for the apply button outside a guild but still claims it", async () => {
    const i = { ...buttonInteraction("wlapp:apply"), guild: null };
    expect(await handle(i)).toBe(true);
    expect(i.showModal).not.toHaveBeenCalled();
  });
});

describe("modal submit", () => {
  it("rejects an invalid Minecraft name without queueing", async () => {
    const i = modalInteraction({ mcName: "not a name!" });
    expect(await handle(i)).toBe(true);
    expect(String(i.editReply.mock.calls[0]![0].content)).toContain("not a name!");
    expect(queueSend).not.toHaveBeenCalled();
    expect(kvGet("whitelistApplications")).toBeNull();
  });

  it("silently ignores guilds without an admin channel configured", async () => {
    mockConfig.guilds = { [GUILD]: { whitelistApplications: { channelId: "x" } } };
    const i = modalInteraction({ mcName: "Steve" });
    expect(await handle(i)).toBe(true);
    expect(i.deferReply).not.toHaveBeenCalled();
  });

  it("queues a pending application on the default server and pings the mention role", async () => {
    const i = modalInteraction({ mcName: "  Steve ", note: " pls " });
    await handle(i);

    expect(queueSend).toHaveBeenCalledTimes(1);
    const sent = queueSend.mock.calls[0]![0] as {
      components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }>;
    };
    const ids = sent.components[0]!.toJSON().components.map((c) => c.custom_id);
    const app = store().applications[0]!;
    expect(ids).toEqual([`wlapp:approve:${app.id}`, `wlapp:deny:${app.id}`]);
    expect(app).toMatchObject({
      guildId: GUILD,
      userId: "u1",
      mcName: "Steve",
      note: "pls",
      serverId: "survival",
      status: "pending",
    });
    expect(sent).toHaveProperty("content");
    expect(String(i.editReply.mock.calls[0]![0].content)).toContain("Steve");
  });

  it("omits the note field when the note is blank", async () => {
    await handle(modalInteraction({ mcName: "Steve", note: "   " }));
    expect(store().applications[0]).not.toHaveProperty("note");
  });

  it("uses the picked server when the guild has no default, and rejects a server outside the visible set", async () => {
    guildTargets.resolveDefaultServerId.mockImplementation(() => {
      throw new Error("ambiguous");
    });
    guildTargets.visibleServerIdsForGuild.mockReturnValue(["a", "b"]);

    await handle(modalInteraction({ mcName: "Steve", server: "b" }));
    expect(store().applications[0]!.serverId).toBe("b");

    closeDbForTesting();
    const bad = modalInteraction({ mcName: "Steve", server: "evil" });
    await handle(bad);
    expect(String(bad.editReply.mock.calls[0]![0].content)).toBeTruthy();
    expect(kvGet("whitelistApplications")).toBeNull();
  });

  it("reports no-server when the picker is missing or empty", async () => {
    guildTargets.resolveDefaultServerId.mockImplementation(() => {
      throw new Error("ambiguous");
    });
    guildTargets.visibleServerIdsForGuild.mockReturnValue(["a", "b"]);
    const none = modalInteraction({ mcName: "Steve" });
    await handle(none);
    const empty = modalInteraction({ mcName: "Steve", server: null });
    await handle(empty);
    expect(none.editReply.mock.calls[0]![0].content).toBe(
      empty.editReply.mock.calls[0]![0].content,
    );
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("allows only one pending application per user per guild", async () => {
    seedApp({ userId: "u1" });
    const i = modalInteraction({ mcName: "Alex" });
    await handle(i);
    expect(queueSend).not.toHaveBeenCalled();
    expect(store().applications).toHaveLength(1);
  });

  it("does not count another user's or a decided application against the limit", async () => {
    seedApp({ id: "a1", userId: "someone-else" });
    seedApp({ id: "a2", userId: "u1", status: "denied", decidedAt: 5 });
    await handle(modalInteraction({ mcName: "Alex" }));
    expect(store().applications).toHaveLength(3);
  });

  it("does not persist the application when the queue channel is unusable", async () => {
    const i = modalInteraction({ mcName: "Steve" }, makeClient({ channel: null }) as never);
    await handle(i);
    expect(kvGet("whitelistApplications")).toBeNull();

    const noSend = modalInteraction({ mcName: "Steve" }, makeClient({ channel: {} }) as never);
    await handle(noSend);
    expect(kvGet("whitelistApplications")).toBeNull();
    expect(noSend.editReply).toHaveBeenCalledTimes(1);
  });

  it("takes the stored application back out when the queue post fails", async () => {
    queueSend.mockRejectedValue(new Error("Missing Access"));
    seedApp({ id: "other", userId: "u2" });
    await expect(handle(modalInteraction({ mcName: "Steve" }))).rejects.toThrow("Missing Access");
    expect(store().applications.map((a) => a.id)).toEqual(["other"]);
  });

  it("stores the row before posting, so a refused second submit never posts", async () => {
    let storedWhenPosted = 0;
    queueSend.mockImplementation(() => {
      storedWhenPosted = store().applications.length;
      return Promise.resolve({ id: "msg-1" });
    });
    await handle(modalInteraction({ mcName: "Steve" }));
    expect(storedWhenPosted).toBe(1);
  });
});

describe("decision buttons", () => {
  it("refuses non-admins before touching the store", async () => {
    isInvokerAdmin.mockReturnValue(false);
    const app = seedApp();
    const i = buttonInteraction(`wlapp:approve:${app.id}`);
    expect(await handle(i)).toBe(true);
    expect(i.reply).toHaveBeenCalledTimes(1);
    expect(i.deferUpdate).not.toHaveBeenCalled();
    expect(performWhitelistAdd).not.toHaveBeenCalled();
    expect(store().applications[0]!.status).toBe("pending");
  });

  it("answers a stale button when the application is unknown or already decided", async () => {
    const decided = seedApp({ id: "done", status: "approved", decidedAt: 2 });
    const unknown = buttonInteraction("wlapp:approve:missing");
    await handle(unknown);
    const again = buttonInteraction(`wlapp:deny:${decided.id}`);
    await handle(again);
    expect(unknown.followUp).toHaveBeenCalledTimes(1);
    expect(again.followUp).toHaveBeenCalledTimes(1);
    expect(performWhitelistAdd).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("approves: whitelists, audits, freezes the queue message and DMs the applicant", async () => {
    performWhitelistAdd.mockResolvedValue({ name: "StEvE" });
    const app = seedApp();
    const i = buttonInteraction(`wlapp:approve:${app.id}`);
    await handle(i);

    expect(performWhitelistAdd).toHaveBeenCalledWith(
      { id: "survival" },
      "Steve",
      { tag: "admin#1", id: "admin1" },
    );
    const saved = store().applications[0]!;
    expect(saved).toMatchObject({ status: "approved", mcName: "StEvE", decidedBy: "admin#1" });
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wlapp approve",
        server: "survival",
        guildId: GUILD,
        detail: "StEvE (applicant user#1)",
      }),
    );
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] }),
    );
    expect(dmSend).toHaveBeenCalledTimes(1);
  });

  it("keeps an application submitted while the approval ran (AUD-005)", async () => {
    const app = seedApp();
    performWhitelistAdd.mockImplementation(async () => {
      seedApp({ id: "other123", userId: "u2", mcName: "Alex", createdAt: 2000 });
      return { name: "Steve" };
    });
    await handle(buttonInteraction(`wlapp:approve:${app.id}`));
    const apps = store().applications;
    expect(apps.map((a) => [a.id, a.status])).toEqual([
      ["abcd1234", "approved"],
      ["other123", "pending"],
    ]);
  });

  it("lets only one of two simultaneous approvals whitelist", async () => {
    const app = seedApp();
    let release!: () => void;
    performWhitelistAdd.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ name: "Steve" }); }),
    );
    const first = handle(buttonInteraction(`wlapp:approve:${app.id}`));
    await vi.waitFor(() => expect(performWhitelistAdd).toHaveBeenCalledTimes(1));

    const second = buttonInteraction(`wlapp:approve:${app.id}`);
    await handle(second);
    expect(second.followUp).toHaveBeenCalledTimes(1);
    expect(performWhitelistAdd).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(store().applications[0]!.status).toBe("approved");
    expect(recordAdminAction).toHaveBeenCalledTimes(1);
  });

  it("refuses a deny while an approval is in flight", async () => {
    const app = seedApp();
    let release!: () => void;
    performWhitelistAdd.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ name: "Steve" }); }),
    );
    const approval = handle(buttonInteraction(`wlapp:approve:${app.id}`));
    await vi.waitFor(() => expect(performWhitelistAdd).toHaveBeenCalledTimes(1));

    const deny = buttonInteraction(`wlapp:deny:${app.id}`);
    await handle(deny);
    expect(deny.followUp).toHaveBeenCalledTimes(1);

    release();
    await approval;
    expect(store().applications[0]!.status).toBe("approved");
  });

  it("takes over a claim abandoned past its expiry", async () => {
    const app = seedApp({ claim: { by: "crashed", at: Date.now() - CLAIM_TTL_MS - 1 } });
    await handle(buttonInteraction(`wlapp:deny:${app.id}`));
    expect(store().applications[0]!.status).toBe("denied");
  });

  it("ignores a button from another guild's admin", async () => {
    const app = seedApp({ guildId: "other-guild" });
    const i = buttonInteraction(`wlapp:approve:${app.id}`);
    await handle(i);
    expect(performWhitelistAdd).not.toHaveBeenCalled();
    expect(store().applications[0]!.status).toBe("pending");
  });

  it("checks the stored server against what the guild may target", async () => {
    const app = seedApp({ serverId: "hidden" });
    await handle(buttonInteraction(`wlapp:approve:${app.id}`));
    expect(getGuildScopedServer).toHaveBeenCalledWith(GUILD, "hidden");
  });

  it("denies without whitelisting", async () => {
    const app = seedApp();
    const i = buttonInteraction(`wlapp:deny:${app.id}`);
    await handle(i);

    expect(performWhitelistAdd).not.toHaveBeenCalled();
    expect(store().applications[0]!.status).toBe("denied");
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "wlapp deny" }),
    );
    expect(dmSend).toHaveBeenCalledTimes(1);
  });

  it("keeps the application pending when the server is gone", async () => {
    getGuildScopedServer.mockReturnValue(null);
    const app = seedApp();
    const i = buttonInteraction(`wlapp:approve:${app.id}`);
    await handle(i);
    expect(i.followUp).toHaveBeenCalledTimes(1);
    expect(store().applications[0]!.status).toBe("pending");
    expect(store().applications[0]).not.toHaveProperty("claim");
    expect(recordAdminAction).not.toHaveBeenCalled();
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it("keeps the application pending when the whitelist add fails", async () => {
    performWhitelistAdd.mockRejectedValue(new Error("mojang down"));
    const app = seedApp();
    const i = buttonInteraction(`wlapp:approve:${app.id}`);
    await handle(i);
    expect(String(i.followUp.mock.calls[0]![0].content)).toContain("mojang down");
    expect(store().applications[0]!.status).toBe("pending");
    expect(store().applications[0]).not.toHaveProperty("claim");
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it("still completes the decision when the applicant has closed DMs", async () => {
    dmSend.mockRejectedValue(new Error("Cannot send messages to this user"));
    const app = seedApp();
    const i = buttonInteraction(`wlapp:deny:${app.id}`);
    await expect(handle(i)).resolves.toBe(true);
    expect(store().applications[0]!.status).toBe("denied");
  });
});

describe("store trimming", () => {
  it("keeps every pending application but caps decided history at 200", async () => {
    const decided = Array.from({ length: 205 }, (_, n) => ({
      id: `d${n}`,
      guildId: GUILD,
      userId: `x${n}`,
      userTag: "t",
      mcName: "N",
      serverId: "survival",
      status: "approved" as const,
      createdAt: n,
      decidedAt: n,
    }));
    kvSet("whitelistApplications", {
      version: 1,
      prompts: {},
      applications: [
        ...decided,
        { ...decided[0], id: "p1", status: "pending", createdAt: 9999, decidedAt: undefined },
        { ...decided[0], id: "p2", status: "pending", createdAt: 9998, decidedAt: undefined },
      ],
    });
    const i = buttonInteraction("wlapp:deny:p1");
    await handle(i);
    const apps = store().applications;
    expect(apps).toHaveLength(201);
    expect(apps.filter((a) => a.status === "pending").map((a) => a.id)).toEqual(["p2"]);
    expect(apps.find((a) => a.id === "d0")).toBeUndefined();
    expect(apps.find((a) => a.id === "p1")?.status).toBe("denied");
  });
});

describe("ensureApplicationPrompts", () => {
  const configs = { [GUILD]: GUILD_CFG } as never;

  it("posts the prompt and remembers its message", async () => {
    const client = makeClient();
    await ensureApplicationPrompts(client as unknown as Client, configs);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(store().prompts[GUILD]).toEqual({ channelId: "apply-ch", messageId: "msg-1" });
  });

  it("skips guilds missing either channel", async () => {
    const client = makeClient();
    await ensureApplicationPrompts(client as unknown as Client, {
      a: { whitelistApplications: { channelId: "only" } },
      b: {},
    } as never);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it("reuses a live prompt and reposts when the stored message is gone or the channel moved", async () => {
    kvSet("whitelistApplications", {
      version: 1,
      prompts: { [GUILD]: { channelId: "apply-ch", messageId: "old" } },
      applications: [],
    });
    const alive = { messages: { fetch: vi.fn().mockResolvedValue({ id: "old" }) }, send: queueSend };
    await ensureApplicationPrompts(makeClient({ channel: alive }) as unknown as Client, configs);
    expect(queueSend).not.toHaveBeenCalled();

    const dead = { messages: { fetch: vi.fn().mockRejectedValue(new Error("gone")) }, send: queueSend };
    await ensureApplicationPrompts(makeClient({ channel: dead }) as unknown as Client, configs);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(store().prompts[GUILD]!.messageId).toBe("msg-1");

    queueSend.mockClear();
    mockConfig.guilds = {};
    await ensureApplicationPrompts(makeClient() as unknown as Client, {
      [GUILD]: { whitelistApplications: { channelId: "other", adminChannelId: "admin-ch" } },
    } as never);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(store().prompts[GUILD]!.channelId).toBe("other");
  });

  it("survives a channel that cannot be fetched", async () => {
    const client = makeClient();
    client.channels.fetch.mockRejectedValue(new Error("Missing Access"));
    await expect(
      ensureApplicationPrompts(client as unknown as Client, configs),
    ).resolves.toBeUndefined();
    expect(kvGet("whitelistApplications")).toBeNull();
  });
});
