import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig = vi.hoisted(() => ({
  adminUsers: [] as string[],
  guilds: {} as Record<string, { adminUsers?: string[] }>,
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => mockConfig,
}));

const links = vi.hoisted(() => ({
  loadLinkedAccountsOrEmpty: vi.fn(),
  findDiscordIdByMcName: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/linkStore.js", () => links);

import {
  getMemberRoleIds,
  isInvokerAdmin,
  isLinkedPlayerAdmin,
  isServerAdmin,
} from "../../src/bot/utils/guild/permissions.js";

beforeEach(() => {
  mockConfig.adminUsers = ["op"];
  mockConfig.guilds = { g1: { adminUsers: ["guild-admin", "role-mod"] } };
  links.loadLinkedAccountsOrEmpty.mockReset().mockResolvedValue({});
  links.findDiscordIdByMcName.mockReset().mockReturnValue(null);
});

describe("isServerAdmin", () => {
  it("accepts operators everywhere and guild admins only in their guild", () => {
    expect(isServerAdmin("op")).toBe(true);
    expect(isServerAdmin("op", [], "g2")).toBe(true);
    expect(isServerAdmin("guild-admin", [], "g1")).toBe(true);
    expect(isServerAdmin("guild-admin", [], "g2")).toBe(false);
    expect(isServerAdmin("guild-admin")).toBe(false);
  });

  it("accepts a listed role", () => {
    expect(isServerAdmin("someone", ["role-mod"], "g1")).toBe(true);
    expect(isServerAdmin("someone", ["role-mod"], "g2")).toBe(false);
  });
});

describe("getMemberRoleIds", () => {
  it("reads the raw array shape, the cached map shape and a missing member", () => {
    expect(getMemberRoleIds({ member: { roles: ["a", "b"] } } as never)).toEqual(["a", "b"]);
    expect(
      getMemberRoleIds({ member: { roles: { cache: new Map([["r1", {}]]) } } } as never),
    ).toEqual(["r1"]);
    expect(getMemberRoleIds({ member: null } as never)).toEqual([]);
  });
});

describe("isInvokerAdmin", () => {
  it("combines the user id, the member roles and the guild of the interaction", () => {
    const interaction = (userId: string, roles: string[], guildId?: string) =>
      ({
        user: { id: userId },
        member: { roles },
        guild: guildId ? { id: guildId } : null,
      }) as never;
    expect(isInvokerAdmin(interaction("op", [], "g1"))).toBe(true);
    expect(isInvokerAdmin(interaction("x", ["role-mod"], "g1"))).toBe(true);
    expect(isInvokerAdmin(interaction("x", ["role-mod"]))).toBe(false);
  });
});

describe("isLinkedPlayerAdmin", () => {
  it("is false for a player without a linked account", async () => {
    expect(await isLinkedPlayerAdmin("Steve")).toBe(false);
  });

  it("follows the linked Discord account against the global list only", async () => {
    links.findDiscordIdByMcName.mockReturnValue("op");
    expect(await isLinkedPlayerAdmin("Steve")).toBe(true);
    links.findDiscordIdByMcName.mockReturnValue("guild-admin");
    expect(await isLinkedPlayerAdmin("Steve")).toBe(false);
  });
});
