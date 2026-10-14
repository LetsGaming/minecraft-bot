// @vitest-environment jsdom
/** AUD-018: a switch during open() leaves exactly one stream, on the new server. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useConsole } from "../../../src/web/frontend/src/composables/useConsole";

const opened: Array<{ url: string; closed: boolean }> = [];
class FakeEventSource {
  onmessage: unknown = null;
  onerror: unknown = null;
  entry: { url: string; closed: boolean };
  constructor(url: string) {
    this.entry = { url, closed: false };
    opened.push(this.entry);
  }
  close(): void {
    this.entry.closed = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  opened.length = 0;
});

describe("useConsole server switch", () => {
  it("does not attach the older server's stream", async () => {
    let releaseA!: () => void;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (input: string) => {
      if (String(input).startsWith("/api/servers/a/")) {
        await new Promise<void>((r) => (releaseA = r));
      }
      return new Response(JSON.stringify({ blockedCommands: [] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });

    const c = useConsole();
    const first = c.open("a");
    await c.open("b");
    releaseA();
    await first;

    const live = opened.filter((o) => !o.closed).map((o) => o.url);
    expect(live).toEqual(["/api/servers/b/console/stream"]);
  });
});
