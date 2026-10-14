// @vitest-environment jsdom
/**
 * AUD-011: a server switch while a list request is in flight must leave the
 * list, and every action built from it, on the server switched to.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useBackups } from "../../../src/web/frontend/src/composables/useBackups";

const fileOf = (id: string) => ({
  id: id.repeat(22).slice(0, 22), tier: "hourly", name: `${id}.tar.zst`, sizeBytes: 1, mtimeMs: 1,
});

afterEach(() => vi.unstubAllGlobals());

describe("useBackups server switch", () => {
  it("shows the newest server's list even when an older answer arrives last", async () => {
    let releaseA!: () => void;
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const body = (f: unknown) =>
        new Response(JSON.stringify({ files: [f], nextCursor: null, total: 1 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      if (url.startsWith("/api/servers/a/")) {
        await new Promise<void>((r) => (releaseA = r));
        return body(fileOf("A"));
      }
      if (url.includes("/restore")) {
        return new Response(JSON.stringify({ ok: true, exitCode: 0 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return body(fileOf("B"));
    });

    const b = useBackups();
    const first = b.load("a");
    await b.load("b");
    releaseA();
    await first;

    expect(b.files.value.map((f) => f.name)).toEqual(["B.tar.zst"]);
    expect(b.loading.value).toBe(false);

    // A confirmation opened on server a's archive does nothing on b.
    const outcome = await b.restore(fileOf("A") as never);
    expect(outcome.ok).toBe(false);
    expect(calls.some((c) => c.includes("/restore"))).toBe(false);

    const ok = await b.restore(fileOf("B") as never);
    expect(ok.ok).toBe(true);
    expect(calls.at(-1)).toContain("/api/servers/b/backups/files/");
  });
});
