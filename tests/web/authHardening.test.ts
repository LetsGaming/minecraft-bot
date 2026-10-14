/**
 * OAuth state binding, session revocation by epoch, and the dev-bypass guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const mockConfig: {
  clientId: string;
  token: string;
  adminUsers: string[];
  servers: Record<string, never>;
  guilds: Record<string, never>;
  webui: { enabled: boolean; port: number; sessionEpoch?: number };
} = {
  clientId: "123456789012345678",
  token: "t",
  adminUsers: [],
  servers: {},
  guilds: {},
  webui: { enabled: true, port: 8130 },
};

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => []),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const discord = vi.hoisted(() => ({
  listBotGuilds: vi.fn(),
}));
vi.mock("../../src/web/backend/auth/discordRest.js", () => discord);

import { buildServer } from "../../src/web/backend/server.js";
import {
  encodeSigned,
  decodeSigned,
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  verifyState,
  buildAuthorizeUrl,
} from "../../src/web/backend/auth/auth.js";

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

function stubDiscord(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("oauth2/token")
        ? { access_token: "tok" }
        : String(url).endsWith("/users/@me")
          ? { id: "444444444444444444", username: "someone", discriminator: "0" }
          : // /users/@me/guilds: one guild the user manages.
            [{ id: "222222222222222222", permissions: "32" }];
      return { ok: true, json: async () => body };
    }),
  );
}

beforeEach(() => {
  mockConfig.webui = { enabled: true, port: 8130 };
  discord.listBotGuilds.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OAuth state binding", () => {
  it("verifyState needs the matching cookie nonce", () => {
    const { state, nonce } = buildAuthorizeUrl();
    expect(verifyState(state, nonce)).toBe(true);
    expect(verifyState(state, undefined)).toBe(false);
    expect(verifyState(state, "0".repeat(nonce.length))).toBe(false);
    expect(verifyState(state, `${nonce}x`)).toBe(false);
  });

  it("rejects an expired state even with the right nonce", () => {
    const state = encodeSigned({ n: "abc", exp: Date.now() - 1 });
    expect(verifyState(state, "abc")).toBe(false);
  });

  it("login sets an HttpOnly state cookie carrying the state's nonce", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/auth/login" });
    expect(res.statusCode).toBe(302);
    const cookie = setCookies(res).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const nonce = cookie.split(";")[0]!.split("=")[1]!;
    const state = new URL(String(res.headers.location)).searchParams.get("state");
    expect(verifyState(state ?? undefined, nonce)).toBe(true);
    await app.close();
  });

  it("callback refuses a valid state that this browser did not start", async () => {
    stubDiscord();
    const app = buildServer();
    const { state } = buildAuthorizeUrl();
    const noCookie = await app.inject({ method: "GET", url: `/auth/callback?code=c&state=${state}` });
    expect(noCookie.statusCode).toBe(400);
    const wrongCookie = await app.inject({
      method: "GET",
      url: `/auth/callback?code=c&state=${state}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE}=deadbeef` },
    });
    expect(wrongCookie.statusCode).toBe(400);
    expect(setCookies(wrongCookie).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    await app.close();
  });

  it("callback signs in when the cookie matches and clears it", async () => {
    stubDiscord();
    const app = buildServer();
    const { state, nonce } = buildAuthorizeUrl();
    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=c&state=${state}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${nonce}` },
    });
    expect(res.statusCode).toBe(302);
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=;`) && c.includes("Max-Age=0"))).toBe(true);
    await app.close();
  });
});

describe("guild scope at login", () => {
  async function login(): Promise<{ guilds: string[] } | null> {
    stubDiscord();
    const app = buildServer();
    const { state, nonce } = buildAuthorizeUrl();
    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=c&state=${state}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${nonce}` },
    });
    await app.close();
    const raw = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    const token = raw?.slice(SESSION_COOKIE.length + 1).split(";")[0];
    return decodeSigned<{ guilds: string[] }>(token);
  }

  it("keeps the managed guilds the bot is in", async () => {
    discord.listBotGuilds.mockResolvedValue([{ id: "222222222222222222" }]);
    expect((await login())?.guilds).toEqual(["222222222222222222"]);
  });

  it("grants no guilds when the bot's guilds can't be listed (AUD-001)", async () => {
    discord.listBotGuilds.mockRejectedValue(new Error("discord down"));
    expect((await login())?.guilds).toEqual([]);
  });
});

describe("session revocation by epoch", () => {
  function cookie(ep?: number): string {
    const session = encodeSigned({
      uid: "444444444444444444",
      tag: "x",
      guilds: [],
      exp: Date.now() + 60_000,
      ...(ep === undefined ? {} : { ep }),
    });
    return `${SESSION_COOKIE}=${session}`;
  }

  async function me(c: string): Promise<number> {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: c } });
    await app.close();
    return res.statusCode;
  }

  it("accepts sessions issued at the current epoch (absent counts as 0)", async () => {
    expect(await me(cookie())).toBe(200);
    expect(await me(cookie(0))).toBe(200);
  });

  it("rejects every older session once the epoch is raised, without a restart", async () => {
    mockConfig.webui.sessionEpoch = 1;
    expect(await me(cookie())).toBe(401);
    expect(await me(cookie(0))).toBe(401);
    expect(await me(cookie(1))).toBe(200);
  });

  it("treats a malformed epoch as 0", async () => {
    mockConfig.webui.sessionEpoch = -3;
    expect(await me(cookie(0))).toBe(200);
  });
});

describe("dev auth bypass guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function guard() {
    vi.resetModules();
    return (await import("../../src/web/backend/auth/auth.js")).assertDevAuthBypassSafe;
  }

  it("does nothing when the bypass is off", async () => {
    vi.stubEnv("MCBOT_DEV_NO_AUTH", "");
    expect((await guard())("0.0.0.0")).toBeUndefined();
  });

  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1"])("allows loopback %s", async (host) => {
    vi.stubEnv("MCBOT_DEV_NO_AUTH", "1");
    expect(() => void (async () => (await guard())(host))()).not.toThrow();
    const assertSafe = await guard();
    expect(() => assertSafe(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "192.168.1.5", "example.com"])("refuses %s", async (host) => {
    vi.stubEnv("MCBOT_DEV_NO_AUTH", "1");
    const assertSafe = await guard();
    expect(() => assertSafe(host)).toThrow(/MCBOT_DEV_NO_AUTH/);
  });

  it("refuses production even on loopback", async () => {
    vi.stubEnv("MCBOT_DEV_NO_AUTH", "1");
    vi.stubEnv("NODE_ENV", "production");
    const assertSafe = await guard();
    expect(() => assertSafe("127.0.0.1")).toThrow(/production/);
  });
});
