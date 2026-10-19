import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));
vi.mock("../../src/core/utils/commands/commandPolicy.js", () => ({
  resolveCommandPolicy: vi
    .fn()
    .mockReturnValue({ enabled: true, adminOnly: false }),
}));
vi.mock("../../src/core/utils/stores/linkStore.js", () => ({
  loadLinkedAccountsOrEmpty: vi.fn().mockResolvedValue({}),
  findDiscordIdByMcName: vi.fn().mockReturnValue(null),
}));
vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  recordCommandUsage: vi.fn(),
}));
vi.mock("../../src/bot/utils/guild/permissions.js", () => ({
  isLinkedPlayerAdmin: vi.fn().mockResolvedValue(false),
}));

import { registerLogCommand } from "../../src/bot/logWatcher/logWatcher.js";
import { init } from "../../src/bot/logWatcher/commands/info/chunkbase.js";

type Handler = (m: RegExpExecArray, c: unknown, s: unknown) => Promise<void>;

let uid = 0;
let regex: RegExp;
let registered: Handler;

beforeEach(() => {
  vi.mocked(registerLogCommand).mockClear();
  init();
  const call = vi.mocked(registerLogCommand).mock.calls.at(-1)!;
  regex = call[0] as RegExp;
  registered = call[1] as unknown as Handler;
});

interface FakeOpts {
  seed?: string | null;
  dimension?: string | null;
  coords?: { x: number; y: number; z: number } | null;
  version?: string | null;
  unreachable?: boolean;
}

const ok = (value: unknown) => ({ ok: true, value });
const fail = (reason = "unreadable") => ({ ok: false, reason });

function fakeServer(opts: FakeOpts = {}) {
  const sent: string[] = [];
  return {
    sent,
    server: {
      id: "srv",
      send: vi.fn(async (c: string) => {
        sent.push(c);
        return { kind: "delivered", output: "" };
      }),
      getSeed: vi.fn().mockResolvedValue(
        opts.unreachable
          ? fail("unreachable")
          : ("seed" in opts ? opts.seed : "4242") === null
            ? fail()
            : ok("seed" in opts ? opts.seed : "4242"),
      ),
      getPlayerDimension: vi
        .fn()
        .mockResolvedValue(
          opts.dimension === null ? fail() : ok(opts.dimension ?? "overworld"),
        ),
      getPlayerCoords: vi
        .fn()
        .mockResolvedValue(
          "coords" in opts
            ? opts.coords === null
              ? fail()
              : ok(opts.coords)
            : ok({ x: 10.7, y: 64, z: -3.2 }),
        ),
      getMinecraftVersion: vi
        .fn()
        .mockResolvedValue("version" in opts ? opts.version : "1.21.4"),
    },
  };
}

async function run(server: unknown): Promise<string> {
  const user = `Player${++uid}`;
  const line = `[12:00:00] [Server thread/INFO]: <${user}> !chunkbase`;
  await registered(regex.exec(line)!, {}, server);
  return user;
}

function tellraw(sent: string[], user: string) {
  const line = sent.find((c) => c.startsWith(`/tellraw ${user} `));
  expect(line).toBeDefined();
  const json = line!.slice(`/tellraw ${user} `.length);
  return JSON.parse(json) as { extra: Array<Record<string, unknown>> };
}

describe("!chunkbase handler", () => {
  it("messages the player when the seed is unavailable", async () => {
    const { server, sent } = fakeServer({ seed: null });
    const user = await run(server);
    expect(sent).toEqual([`/msg ${user} Could not retrieve the world seed.`]);
    expect(server.getPlayerCoords).not.toHaveBeenCalled();
  });

  it("says the server is unreachable instead of blaming the seed", async () => {
    const { server, sent } = fakeServer({ unreachable: true });
    const user = await run(server);
    expect(sent).toEqual([
      `/msg ${user} Could not reach the server right now. Try again in a moment.`,
    ]);
  });

  it("does not build a link with a guessed dimension", async () => {
    const { server, sent } = fakeServer({ dimension: null });
    const user = await run(server);
    expect(sent).toEqual([
      `/msg ${user} Could not tell which dimension you are in. Try again in a moment.`,
    ]);
  });

  it("emits valid tellraw JSON with the URL as plain text", async () => {
    const { server, sent } = fakeServer();
    const user = await run(server);
    const root = tellraw(sent, user);
    const url =
      "https://www.chunkbase.com/apps/seed-map#seed=4242&dimension=overworld&x=10&z=-4";
    const texts = root.extra.map((e) => String(e.text).trim());
    expect(texts).toContain(url);
    expect(
      root.extra.some((e) => "clickEvent" in e || "click_event" in e),
    ).toBe(true);
  });

  it("uses clickEvent/value below 1.21.5 only", async () => {
    const { server, sent } = fakeServer({ version: "1.21.4" });
    const user = await run(server);
    const link = tellraw(sent, user).extra.find((e) => e.clickEvent)!;
    expect(link.clickEvent).toEqual({
      action: "open_url",
      value: expect.stringContaining("chunkbase.com"),
    });
    expect(link).not.toHaveProperty("click_event");
  });

  it("uses click_event/url from 1.21.5 only", async () => {
    const { server, sent } = fakeServer({ version: "1.21.5" });
    const user = await run(server);
    const link = tellraw(sent, user).extra.find((e) => e.click_event)!;
    expect(link.click_event).toEqual({
      action: "open_url",
      url: expect.stringContaining("chunkbase.com"),
    });
    expect(link).not.toHaveProperty("clickEvent");
  });

  it("carries both formats when the version is unknown", async () => {
    const { server, sent } = fakeServer({ version: null });
    const user = await run(server);
    const link = tellraw(sent, user).extra.find((e) => e.clickEvent)!;
    expect(link).toHaveProperty("click_event");
  });

  it("maps the nether dimension and omits coordinates when unknown", async () => {
    const { server, sent } = fakeServer({
      dimension: "the_nether",
      coords: null,
    });
    const user = await run(server);
    const texts = tellraw(sent, user).extra.map((e) => String(e.text).trim());
    const url = texts.find((t) => t.startsWith("https://"))!;
    expect(url).toContain("dimension=nether");
    expect(url).not.toContain("&x=");
  });

  it("proceeds without coordinates when the position cannot be read", async () => {
    const { server, sent } = fakeServer();
    server.getPlayerCoords.mockResolvedValue(fail("player-offline"));
    const user = await run(server);
    const texts = tellraw(sent, user).extra.map((e) => String(e.text).trim());
    expect(texts.find((t) => t.startsWith("https://"))).not.toContain("&x=");
  });

  it("reads the dimension through the polling helper", async () => {
    const { server } = fakeServer();
    await run(server);
    expect(server.getPlayerDimension).toHaveBeenCalledTimes(1);
  });
});
