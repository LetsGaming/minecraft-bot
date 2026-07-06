/**
 * Connection commands: /link, /linkstatus, /unlink
 * General commands: /help
 * Scheduler: startChannelPurge, startTpsMonitor
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ──────────────────────────────────────────────────────────
vi.mock("../src/core/utils/linkUtils.js", () => ({
  LINK_CODE_TTL_MS: 5 * 60 * 1000,
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
  saveLinkedAccounts: vi.fn().mockResolvedValue(undefined),
  loadLinkCodes: vi.fn().mockResolvedValue({}),
  saveLinkCodes: vi.fn().mockResolvedValue(undefined),
  isLinked: vi.fn().mockResolvedValue(false),
  getLinkedAccount: vi.fn().mockResolvedValue(null),
  issueLinkCode: vi.fn(),
  confirmLinkCode: vi.fn(),
  unlinkAccount: vi.fn().mockResolvedValue(false),
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => ({
    _opts: opts,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    toJSON: () => ({ title: opts?.title }),
  })),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
  createSuccessEmbed: vi
    .fn()
    .mockReturnValue({
      type: "success-embed",
      setDescription: vi.fn().mockReturnThis(),
    }),
  createPaginationButtons: vi.fn().mockReturnValue({ type: "buttons" }),
  handlePagination: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/core/utils/time.js", () => ({
  nextMidnightEpoch: vi.fn().mockReturnValue(Date.now() + 3_600_000),
  msUntilMidnight: vi.fn().mockReturnValue(3_600_000),
  formatDate: vi.fn(),
  formatDatetime: vi.fn().mockReturnValue("2025-01-01 00:00:00"),
  formatTime: vi.fn(),
  TZ: "UTC",
}));

vi.mock("../src/core/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    adminUsers: [],
    servers: {},
    guilds: {},
    leaderboardInterval: "daily",
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 60_000,
  }),
  reloadConfig: vi.fn().mockReturnValue({
    adminUsers: [],
    servers: {},
    guilds: {},
  }),
  getServerIds: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
  isServerAdmin: vi.fn().mockReturnValue(true),
}));

vi.mock("../src/core/utils/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

import {
  loadLinkCodes,
  loadLinkedAccounts,
  saveLinkedAccounts,
  getLinkedAccount,
  issueLinkCode,
  unlinkAccount,
} from "../src/core/utils/linkUtils.js";
import type { ChatInputCommandInteraction } from "discord.js";

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user123", tag: "User#0001" },
    commandName: "cmd",
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg1" }),
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn().mockReturnValue(null),
      getSubcommand: vi.fn().mockReturnValue("show"),
    },
    client: {
      ws: { ping: 50 },
      commands: new Map([
        ["ping", { data: { name: "ping", description: "Ping!", options: [] } }],
        ["help", { data: { name: "help", description: "Help!", options: [] } }],
      ]),
    },
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// /link command
// ══════════════════════════════════════════════════════════════════════════════

describe("/link command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/connection/link.js"));
  });

  it("replies with ephemeral code when the store issues one", async () => {
    vi.mocked(issueLinkCode).mockResolvedValue({
      status: "issued",
      code: "ABCD1234",
      expires: Date.now() + 300_000,
    });
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(issueLinkCode).toHaveBeenCalledWith(
      "user123",
      expect.stringMatching(/^[0-9A-F]{8}$/),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("ABCD1234"),
        flags: expect.anything(),
      }),
    );
  });

  it("replies with 'already pending' when the store reports a pending code", async () => {
    vi.mocked(issueLinkCode).mockResolvedValue({
      status: "pending",
      code: "ABC123",
    });
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("already have"),
      }),
    );
  });

  it("replies with 'already linked' when an account link exists", async () => {
    vi.mocked(issueLinkCode).mockResolvedValue({ status: "already-linked" });
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("already linked"),
      }),
    );
  });

  it("relies on the store to prune expired codes and issue a new one", async () => {
    // Pruning happens inside issueLinkCode's transaction now; the command
    // only relays the result.
    vi.mocked(issueLinkCode).mockResolvedValue({
      status: "issued",
      code: "NEW45678",
      expires: Date.now() + 300_000,
    });
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("NEW45678"),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /linkstatus command
// ══════════════════════════════════════════════════════════════════════════════

describe("/linkstatus command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/connection/linkStatus.js"));
  });

  it("replies with 'not linked' when no account is linked", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue(null);
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("not linked"),
      }),
    );
  });

  it("replies with the linked Minecraft username", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Steve") }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /unlink command
// ══════════════════════════════════════════════════════════════════════════════

describe("/unlink command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/connection/unlink.js"));
  });

  it("replies with 'not linked' when user has no linked account", async () => {
    vi.mocked(unlinkAccount).mockResolvedValue(false);
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("not linked"),
      }),
    );
  });

  it("unlinks the account and replies with success", async () => {
    vi.mocked(unlinkAccount).mockResolvedValue(true);
    const interaction = makeInteraction();
    await execute(interaction as never);
    expect(unlinkAccount).toHaveBeenCalledWith("user123");
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("unlinked") }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// /help command
// ══════════════════════════════════════════════════════════════════════════════

describe("/help command", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/bot/commands/general/help.js"));
  });

  it("calls reply with help embed and handles fetchReply error gracefully", async () => {
    const interaction = makeInteraction();
    // help.ts calls fetchReply after reply — add that mock
    (
      interaction as never as { fetchReply: ReturnType<typeof vi.fn> }
    ).fetchReply = vi.fn().mockRejectedValue(new Error("Interaction expired"));
    await execute(interaction as never);
    expect(interaction.reply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startChannelPurge
// ══════════════════════════════════════════════════════════════════════════════

describe("startChannelPurge", () => {
  let startChannelPurge: (
    client: never,
    guildConfigs: Record<string, never>,
  ) => void;
  beforeEach(async () => {
    ({ startChannelPurge } =
      await import("../src/bot/logWatcher/watchers/channelPurge.js"));
  });

  it("logs and returns when no guilds have purge configured", async () => {
    const { log } = vi.mocked(await import("../src/core/utils/logger.js"));
    startChannelPurge(null as never, {});
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      "purge",
      expect.stringContaining("No channel purge targets"),
    );
  });

  it("does not throw when called with guilds that have channelPurge configured", () => {
    const guildConfigs = {
      guild1: { channelPurge: { channelId: "ch1" } },
    };
    expect(() =>
      startChannelPurge(null as never, guildConfigs as never),
    ).not.toThrow();
    // Note: the timeout runs in the future, no need to clean up in this test
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startTpsMonitor
// ══════════════════════════════════════════════════════════════════════════════

describe("startTpsMonitor", () => {
  let startTpsMonitor: (
    server: never,
    client: never,
    guilds: Record<string, never>,
  ) => ReturnType<typeof setInterval> | null;
  beforeEach(async () => {
    ({ startTpsMonitor } =
      await import("../src/bot/logWatcher/watchers/tpsMonitor.js"));
  });

  it("returns null when server does not support TPS", () => {
    const server = { id: "main", supportsTps: false } as never;
    const result = startTpsMonitor(server, null as never, {});
    expect(result).toBeNull();
  });

  it("returns a timer when server supports TPS", () => {
    const server = { id: "main", supportsTps: true, getTps: vi.fn() } as never;
    const timer = startTpsMonitor(server, null as never, {});
    expect(timer).toBeTruthy();
    clearInterval(timer!);
  });
});
