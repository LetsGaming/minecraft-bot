import { beforeAll, describe, it, expect } from "vitest";

type OptionJson = {
  name: string;
  type: number;
  required?: boolean;
  autocomplete?: boolean;
  options?: OptionJson[];
};

const SUBCOMMAND = 1;

function serverOptions(options: OptionJson[]): OptionJson[] {
  return options.flatMap((o) =>
    o.type === SUBCOMMAND ? serverOptions(o.options ?? []) : o.name === "server" ? [o] : [],
  );
}

const commands = {
  whitelisted: () => import("../../src/bot/commands/info/whitelisted.js"),
  stats: () => import("../../src/bot/commands/stats/stats.js"),
  top: () => import("../../src/bot/commands/stats/top.js"),
  leaderboard: () => import("../../src/bot/commands/stats/leaderboard.js"),
  playtime: () => import("../../src/bot/commands/stats/playtime.js"),
  compare: () => import("../../src/bot/commands/stats/compare.js"),
  uptime: () => import("../../src/bot/commands/info/uptime.js"),
  "daily-admin": () => import("../../src/bot/commands/admin/dailyAdmin.js"),
};

describe("server: option", () => {
  beforeAll(async () => {
    await Promise.all(Object.values(commands).map((load) => load()));
  }, 120_000);

  it.each(Object.entries(commands))(
    "%s offers an optional autocompleted server option",
    async (_name, load) => {
      const json = (await load()).data.toJSON() as { options?: OptionJson[] };
      const found = serverOptions(json.options ?? []);
      expect(found.length).toBeGreaterThan(0);
      for (const opt of found) {
        expect(opt.required).toBeFalsy();
        expect(opt.autocomplete).toBe(true);
      }
    },
  );

  it("stats exposes server on both player and daily", async () => {
    const json = (await commands.stats()).data.toJSON() as { options: OptionJson[] };
    for (const sub of json.options) {
      expect(serverOptions(sub.options ?? [])).toHaveLength(1);
    }
  });
});
