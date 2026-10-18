import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
  PLAYER_NAME: String.raw`\.?[A-Za-z0-9_]{1,16}`,
  broadcastNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn((player: string, o: object) => ({ player, ...o })),
  createEmbed: vi.fn((o: object) => o),
}));
vi.mock("../../src/core/utils/minecraft/eventTips.js", () => ({
  tipForEvent: vi.fn().mockResolvedValue(false),
  deliverEventTip: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/stores/challengeStore.js", () => ({
  loadChallengeStore: vi.fn().mockResolvedValue({}),
  saveChallengeStore: vi.fn().mockResolvedValue(undefined),
  expireStale: vi.fn().mockReturnValue(false),
  getActiveChallenge: vi.fn().mockReturnValue(null),
}));

import { broadcastNotification } from "../../src/bot/logWatcher/watchers/notifyGuilds.js";
import { createPlayerEmbed } from "../../src/bot/utils/embeds/embedUtils.js";
import { EmbedCategory } from "../../src/schema/embedCategories.js";
import { registerDeathWatcher } from "../../src/bot/logWatcher/watchers/log/deaths.js";
import { registerAdvancementWatcher } from "../../src/bot/logWatcher/watchers/log/advancements.js";

type Handler = (match: RegExpExecArray, client: unknown, server: unknown) => Promise<void>;

function capture(register: (w: never) => void) {
  const entries: { regex: RegExp; handler: Handler }[] = [];
  const watcher = {
    server: { id: "s1" },
    register: (regex: RegExp, handler: Handler) => entries.push({ regex, handler }),
  };
  register(watcher as never);
  return entries[0]!;
}

const line = (msg: string) => `[12:00:00] [Server thread/INFO]: ${msg}`;

const VANILLA_DEATHS = [
  "Steve was shot by Skeleton",
  "Steve was pricked to death",
  "Steve walked into a cactus whilst trying to escape Zombie",
  "Steve drowned",
  "Steve experienced kinetic energy",
  "Steve blew up",
  "Steve was blown up by Creeper",
  "Steve hit the ground too hard",
  "Steve fell from a high place",
  "Steve fell off a ladder",
  "Steve was doomed to fall",
  "Steve was squashed by a falling anvil",
  "Steve went off with a bang",
  "Steve tried to swim in lava",
  "Steve was killed by magic",
  "Steve was slain by Zombie",
  "Steve was fireballed by Ghast",
  "Steve was impaled by Drowned",
  "Steve starved to death",
  "Steve suffocated in a wall",
  "Steve was squished too much",
  "Steve was poked to death by a sweet berry bush",
  "Steve was pummeled by Snowball",
  "Steve withered away",
  "Steve was stung to death",
  "Steve was obliterated by a sonically-charged shriek",
  "Steve was skewered by a falling stalactite",
  "Steve died",
  "Steve died from dehydration",
  "Steve froze to death",
  "Steve was frozen to death by Skeleton",
  "Steve was struck by lightning",
  "Steve went up in flames",
  "Steve burned to death",
  "Steve was burned to a crisp whilst fighting Zombie",
  "Steve was burnt to a crisp whilst fighting Zombie",
  "Steve discovered the floor was lava",
  "Steve was roasted in dragon's breath",
  "Steve was smashed by Zombie",
  "Steve left the confines of this world",
  "Steve fell out of the world",
  "Steve didn't want to live in the same world as Zombie",
];

describe("death watcher", () => {
  const { regex } = capture((w) => registerDeathWatcher(w, {} as never, {} as never));

  it.each(VANILLA_DEATHS)("matches %s", (msg) => {
    const m = regex.exec(line(msg));
    expect(m).not.toBeNull();
    expect(m![1]).toBe("Steve");
  });

  it("does not match ordinary server lines", () => {
    expect(regex.exec(line("Steve joined the game"))).toBeNull();
  });
});

describe("advancement watcher", () => {
  beforeEach(() => vi.clearAllMocks());

  async function run(msg: string) {
    const { regex, handler } = capture((w) =>
      registerAdvancementWatcher(w, {} as never, {} as never),
    );
    const m = regex.exec(line(msg));
    expect(m).not.toBeNull();
    await handler(m!, {}, { id: "s1" });
    const spec = vi.mocked(broadcastNotification).mock.calls.at(-1)![2] as {
      buildEmbed: (withFooter: boolean) => unknown;
    };
    spec.buildEmbed(false);
    return m!;
  }

  it("captures a title containing brackets whole", async () => {
    const m = await run("Steve has made the advancement [Why [It] Happened]");
    expect(m[3]).toBe("Why [It] Happened");
  });

  it("captures a plain title", async () => {
    const m = await run("Steve has made the advancement [Diamonds!]");
    expect(m[3]).toBe("Diamonds!");
  });

  it("treats a challenge by its verb, not by a title containing the phrase", async () => {
    await run("Steve has made the advancement [has completed the challenge]");
    await run("Steve has completed the challenge [Return to Sender]");
    const categories = vi.mocked(createPlayerEmbed).mock.calls.map(
      (c) => (c[1] as { category: string }).category,
    );
    expect(categories).toEqual([EmbedCategory.Advancement, EmbedCategory.Milestone]);
  });
});
