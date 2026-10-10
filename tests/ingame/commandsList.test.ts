import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  loadLinkedAccountsOrEmpty: vi.fn().mockResolvedValue({}),
  findDiscordIdByMcName: vi.fn().mockReturnValue(null),
}));
vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  recordCommandUsage: vi.fn(),
}));
vi.mock("../../src/bot/commands/middleware.js", () => ({
  isServerAdmin: vi.fn().mockReturnValue(false),
}));
vi.mock("../../src/core/utils/commands/commandPolicy.js", () => ({
  resolveCommandPolicy: vi.fn(),
}));

vi.mock("../../src/bot/utils/commands/loadCommandFiles.js", () => ({
  getCommandFiles: () => [
    path.resolve(__dirname, "../fixtures/ingameCommands/info/alpha.ts"),
    path.resolve(__dirname, "../fixtures/ingameCommands/general/beta.ts"),
    path.resolve(__dirname, "../fixtures/ingameCommands/info/gamma.ts"),
    path.resolve(__dirname, "../fixtures/ingameCommands/general/commands.ts"),
  ],
}));

import { registerLogCommand } from "../../src/bot/logWatcher/logWatcher.js";
import { resolveCommandPolicy } from "../../src/core/utils/commands/commandPolicy.js";
import { init } from "../../src/bot/logWatcher/commands/general/commands.js";
import { DELIVERED } from "../fixtures/outcomes.js";

type Handler = (m: RegExpExecArray, c: unknown, s: unknown) => Promise<void>;

describe("!commands", () => {
  let regex: RegExp;
  let registered: Handler;
  let n = 0;

  beforeEach(() => {
    vi.mocked(resolveCommandPolicy).mockReturnValue({
      enabled: true,
      adminOnly: false,
    } as never);
    vi.mocked(registerLogCommand).mockClear();
    init();
    const call = vi.mocked(registerLogCommand).mock.calls.at(-1)!;
    regex = call[0] as RegExp;
    registered = call[1] as unknown as Handler;
  });

  async function run(): Promise<string[]> {
    const sent: string[] = [];
    const server = {
      id: "srv",
      send: vi.fn(async (c: string) => {
        sent.push(c);
        return DELIVERED;
      }),
    };
    const line = `[12:00:00] [Server thread/INFO]: <Lister${++n}> !commands`;
    await registered(regex.exec(line)!, {}, server);
    return sent;
  }

  it("lists commands from every folder", async () => {
    const out = (await run()).join("\n");
    expect(out).toContain("!alpha - First");
    expect(out).toContain("!beta <x> - Second");
    expect(out).toContain("!gamma - Third");
  });

  it("omits commands disabled for the server", async () => {
    vi.mocked(resolveCommandPolicy).mockImplementation(
      (name) => ({ enabled: name !== "beta", adminOnly: false }) as never,
    );
    const out = (await run()).join("\n");
    expect(out).toContain("!alpha");
    expect(out).not.toContain("!beta");
    expect(vi.mocked(resolveCommandPolicy)).toHaveBeenCalledWith("beta", {
      serverId: "srv",
    });
  });
});
