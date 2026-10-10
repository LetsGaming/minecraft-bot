import { describe, it, expect, vi, beforeEach } from "vitest";

const toastAdd = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/usetoast/index.mjs", () => ({
  useToast: () => ({ add: toastAdd }),
}));

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { ApiError } from "../../src/web/frontend/src/api.js";
import {
  useGuildSetup,
  buildGuildBlock,
  seedModel,
} from "../../src/web/frontend/src/composables/useGuildSetup.js";

const RICH: Record<string, unknown> = {
  defaultServer: "smp",
  language: "de",
  timezone: "Europe/Berlin",
  adminUsers: ["111"],
  allowedServers: ["smp", "creative"],
  commands: { ping: { enabled: false } },
  notifications: {
    channelId: "c-notif",
    server: "creative",
    mentionRole: "r-1",
    events: ["join", "leave"],
  },
  chatBridge: [
    { channelId: "c-a", server: "smp", useWebhook: true },
    { channelId: "c-b", server: "creative", useWebhook: false },
  ],
  leaderboard: { channelId: "c-lb", interval: "monthly", postTime: "18:00", postDay: "friday", server: "smp" },
  statusEmbed: { enabled: true, channelId: "c-status", messageId: "m-1" },
  downtimeAlerts: { channelId: "c-down", server: "smp", mentionRole: "r-2" },
  whitelistApplications: { channelId: "c-app", adminChannelId: "c-staff", cooldownHours: 12 },
  linkedRole: "r-linked",
};

describe("buildGuildBlock", () => {
  it("re-running the wizard on a configured guild without changes loses nothing", () => {
    const rebuilt = buildGuildBlock(RICH, seedModel(RICH), "smp");
    expect(rebuilt).toEqual(RICH);
  });

  it("keeps chatBridge arrays whole while the feature stays on", () => {
    const model = seedModel(RICH);
    expect(model.chatBridge!.preserved).toBe(true);
    const rebuilt = buildGuildBlock(RICH, model, "smp");
    expect(rebuilt.chatBridge).toEqual(RICH.chatBridge);
  });

  it("merges edits into a feature without dropping its other sub-keys", () => {
    const model = seedModel(RICH);
    model.notifications!.channelId = "c-new";
    model.leaderboard!.interval = "daily";
    model.downtimeAlerts!.channelId = "c-down2";
    const rebuilt = buildGuildBlock(RICH, model, "smp");
    expect(rebuilt.notifications).toEqual({
      channelId: "c-new",
      server: "creative",
      mentionRole: "r-1",
      events: ["join", "leave"],
    });
    expect(rebuilt.leaderboard).toEqual({
      channelId: "c-lb",
      interval: "daily",
      postTime: "18:00",
      postDay: "friday",
      server: "smp",
    });
    expect(rebuilt.downtimeAlerts).toEqual({ channelId: "c-down2", server: "smp", mentionRole: "r-2" });
    expect(rebuilt.whitelistApplications).toEqual(RICH.whitelistApplications);
  });

  it("removes a feature only when the user switched it off", () => {
    const model = seedModel(RICH);
    model.downtimeAlerts!.enabled = false;
    const rebuilt = buildGuildBlock(RICH, model, "smp");
    expect(rebuilt).not.toHaveProperty("downtimeAlerts");
    expect(rebuilt.reports).toBeUndefined();
    expect(rebuilt.leaderboard).toEqual(RICH.leaderboard);
  });

  it("turns a status embed off without losing its channel", () => {
    const model = seedModel(RICH);
    model.statusEmbed!.enabled = false;
    expect(buildGuildBlock(RICH, model, "smp").statusEmbed).toEqual({
      enabled: false,
      channelId: "c-status",
      messageId: "m-1",
    });
  });

  it("leaves a disabled status embed with extra keys alone when never enabled", () => {
    const existing = { statusEmbed: { enabled: false, channelId: "x" } };
    expect(buildGuildBlock(existing, seedModel(existing), null)).toEqual(existing);
  });

  it("seeds a new block with the default notification events", () => {
    const model = seedModel({});
    model.notifications!.enabled = true;
    model.notifications!.channelId = "c1";
    const out = buildGuildBlock({}, model, null);
    expect((out.notifications as { events: string[] }).events.length).toBeGreaterThan(0);
  });
});

describe("useGuildSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function wire(opts: { hash?: string; block?: Record<string, unknown>; seedFails?: boolean } = {}) {
    net.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/guilds/g1/config") {
        if (opts.seedFails) throw new ApiError(500, "boom");
        return { hash: opts.hash ?? "hash-seed", guildConfig: opts.block ?? RICH };
      }
      throw new Error(`unexpected ${path}`);
    });
  }

  it("writes with the hash from the seed read and never refetches it", async () => {
    wire();
    net.apiSend.mockResolvedValue({ ok: true });
    const s = useGuildSetup(() => true, () => "");
    s.guildId.value = "g1";
    await s.onGuildPicked();
    expect(s.seeded.value).toBe(true);
    net.apiGet.mockClear();

    expect(await s.write()).toBe(true);
    expect(net.apiGet).not.toHaveBeenCalled();
    expect(net.apiSend).toHaveBeenCalledWith("PUT", "/api/guilds/g1/config", {
      baseHash: "hash-seed",
      guildConfig: RICH,
    });
  });

  it("blocks writing and shows the failure when seeding fails", async () => {
    wire({ seedFails: true });
    const s = useGuildSetup(() => true, () => "");
    s.guildId.value = "g1";
    await s.onGuildPicked();
    expect(s.seeded.value).toBe(false);
    expect(s.seedError.value).toMatch(/boom/);
    expect(await s.write()).toBe(false);
    expect(net.apiSend).not.toHaveBeenCalled();
    expect(s.writeError.value).not.toBe("");
  });

  it("recovers from a failed seed on retry", async () => {
    wire({ seedFails: true });
    const s = useGuildSetup(() => true, () => "");
    s.guildId.value = "g1";
    await s.onGuildPicked();
    wire();
    expect(await s.seedFromExisting()).toBe(true);
    expect(s.seedError.value).toBe("");
    expect(s.canWrite.value).toBe(true);
  });

  it("awaits the seed when opened on an existing guild", async () => {
    net.apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/setup/guilds") return { guilds: [{ id: "g1", name: "One" }] };
      if (path === "/api/guilds") return { guilds: [{ id: "g1", configured: true }] };
      if (path === "/api/guilds/g1/config") return { hash: "h", guildConfig: RICH };
      throw new Error(`unexpected ${path}`);
    });
    const s = useGuildSetup(() => false, () => "g1");
    await s.loadGuilds();
    expect(s.seeded.value).toBe(true);
    expect(s.defaultServer.value).toBe("smp");
  });

  it("reports a conflict without writing and can reload the latest block", async () => {
    wire();
    net.apiSend.mockRejectedValue(new ApiError(409, "changed", "CONFLICT"));
    const s = useGuildSetup(() => true, () => "");
    s.guildId.value = "g1";
    await s.onGuildPicked();
    expect(await s.write()).toBe(false);
    expect(s.conflicted.value).toBe(true);
    expect(s.writeError.value).toMatch(/changed while the wizard was open/);

    wire({ hash: "hash-new", block: { language: "en" } });
    expect(await s.reloadLatest()).toBe(true);
    expect(s.conflicted.value).toBe(false);
    net.apiSend.mockResolvedValue({ ok: true });
    await s.write();
    expect(net.apiSend).toHaveBeenLastCalledWith("PUT", "/api/guilds/g1/config", {
      baseHash: "hash-new",
      guildConfig: { language: "en" },
    });
  });

  it("lists validation failures from the backend", async () => {
    wire();
    net.apiSend.mockRejectedValue(
      new ApiError(422, "Validation failed", "VALIDATION_FAILED", { errors: ["a", "b"] }),
    );
    const s = useGuildSetup(() => true, () => "");
    s.guildId.value = "g1";
    await s.onGuildPicked();
    await s.write();
    expect(s.writeError.value).toBe("a\nb");
  });
});
