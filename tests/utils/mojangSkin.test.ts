/**
 * Mojang's skin lookups: reading the texture hash out of a session-server
 * profile, and telling an unknown account from a failed or rate-limited call.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  lookupMojangProfile,
  lookupMojangSkin,
  parseSkinTexture,
} from "../../src/core/utils/minecraft/mojang.js";

const HASH = "b914cf5106aaa82409fdd9213fbdb1479b4d65aecc5d5e22b1f25e5744c4c4f7";
const UUID = "94a654f9300a4dde95031ad8f85d20d2";

function profile(textures: unknown, extra: Record<string, unknown> = {}): unknown {
  const value = Buffer.from(JSON.stringify({ textures })).toString("base64");
  return { id: UUID, name: "Steve", properties: [{ name: "textures", value }], ...extra };
}

const skinUrl = (hash: string): string => `http://textures.minecraft.net/texture/${hash}`;

afterEach(() => vi.unstubAllGlobals());

describe("parseSkinTexture", () => {
  it("reads the hash from the end of the skin URL", () => {
    expect(parseSkinTexture(profile({ SKIN: { url: skinUrl(HASH) } }))).toEqual({ hash: HASH });
  });

  it("lowercases the hash and ignores the model and the cape", () => {
    const upper = HASH.toUpperCase();
    const raw = profile({
      SKIN: { url: skinUrl(upper), metadata: { model: "slim" } },
      CAPE: { url: skinUrl("c".repeat(64)) },
    });
    expect(parseSkinTexture(raw)).toEqual({ hash: HASH });
  });

  it("has no hash for a profile with only a cape, empty textures, or no textures property", () => {
    expect(parseSkinTexture(profile({ CAPE: { url: skinUrl(HASH) } }))).toEqual({ hash: null });
    expect(parseSkinTexture(profile({}))).toEqual({ hash: null });
    expect(parseSkinTexture({ id: UUID, name: "Steve", properties: [] })).toEqual({ hash: null });
  });

  it("rejects a body that is not a profile", () => {
    expect(parseSkinTexture(null)).toBeNull();
    expect(parseSkinTexture("text")).toBeNull();
    expect(parseSkinTexture({ id: UUID })).toBeNull();
    expect(parseSkinTexture({ properties: "no" })).toBeNull();
  });

  it("rejects textures it cannot decode or a URL that holds no hash", () => {
    expect(parseSkinTexture({ properties: [{ name: "textures", value: "%%%not-base64-json%%%" }] })).toBeNull();
    expect(parseSkinTexture({ properties: [{ name: "textures", value: 5 }] })).toBeNull();
    expect(parseSkinTexture(profile({ SKIN: {} }))).toBeNull();
    expect(parseSkinTexture(profile({ SKIN: { url: skinUrl("not-a-hash") } }))).toBeNull();
    expect(parseSkinTexture(profile({ SKIN: { url: skinUrl("abc") } }))).toBeNull();
  });
});

function stub(response: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("lookupMojangProfile", () => {
  it("finds an account and asks for the encoded name", async () => {
    const fetchMock = stub(() => json({ id: UUID, name: "Some Name" }));
    expect(await lookupMojangProfile("Some Name")).toEqual({
      kind: "found",
      value: { id: UUID, name: "Some Name" },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.mojang.com/users/profiles/minecraft/Some%20Name");
  });

  it("says unknown for a 404", async () => {
    stub(() => new Response("", { status: 404 }));
    expect(await lookupMojangProfile("Nobody")).toEqual({ kind: "unknown" });
  });

  it("says unavailable and rate limited for a 429, and only unavailable for other failures", async () => {
    stub(() => new Response("", { status: 429 }));
    expect(await lookupMojangProfile("Steve")).toEqual({ kind: "unavailable", rateLimited: true });
    stub(() => new Response("", { status: 500 }));
    expect(await lookupMojangProfile("Steve")).toEqual({ kind: "unavailable", rateLimited: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await lookupMojangProfile("Steve")).toEqual({ kind: "unavailable", rateLimited: false });
  });

  it("treats a body that is not a profile as unavailable, never as a wrong profile", async () => {
    stub(() => json({ nope: true }));
    expect(await lookupMojangProfile("Steve")).toEqual({ kind: "unavailable", rateLimited: false });
  });
});

describe("lookupMojangSkin", () => {
  it("finds the skin hash of an account", async () => {
    const fetchMock = stub(() => json(profile({ SKIN: { url: skinUrl(HASH) } })));
    expect(await lookupMojangSkin(UUID)).toEqual({ kind: "found", value: { hash: HASH } });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://sessionserver.mojang.com/session/minecraft/profile/${UUID}`,
    );
  });

  it("finds a default skin as a null hash", async () => {
    stub(() => json(profile({})));
    expect(await lookupMojangSkin(UUID)).toEqual({ kind: "found", value: { hash: null } });
  });

  it("is unavailable for an empty 204, a 429 and a misshapen body", async () => {
    stub(() => new Response(null, { status: 204 }));
    expect(await lookupMojangSkin(UUID)).toEqual({ kind: "unavailable", rateLimited: false });
    stub(() => new Response("", { status: 429 }));
    expect(await lookupMojangSkin(UUID)).toEqual({ kind: "unavailable", rateLimited: true });
    stub(() => json({ id: UUID }));
    expect(await lookupMojangSkin(UUID)).toEqual({ kind: "unavailable", rateLimited: false });
  });
});
