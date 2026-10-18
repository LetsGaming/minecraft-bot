import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(() => ({ id: "survival", config: {} })),
}));
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  tailLog: vi.fn(),
}));

import { tailLog } from "../../src/core/utils/server/serverAccess.js";
import { execute } from "../../src/bot/commands/admin/console.js";

function makeInteraction() {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const i = {
    options: {
      getSubcommand: vi.fn(() => "tail"),
      getInteger: vi.fn(() => 100),
    },
    editReply,
  };
  return { i: i as never, editReply };
}

beforeEach(() => vi.clearAllMocks());

describe("/console tail", () => {
  it("keeps the whole message under the 2000 character content cap", async () => {
    const lines = Array.from(
      { length: 100 },
      (_, n) =>
        `[12:00:00] [Server thread/INFO]: line ${String(n).padStart(3, "0")} ${"x".repeat(60)}`,
    );
    vi.mocked(tailLog).mockResolvedValue(lines.join("\n"));
    const { i, editReply } = makeInteraction();
    await execute(i);
    const { content } = editReply.mock.calls[0]![0] as { content: string };
    expect(content.length).toBeLessThan(2000);
    expect(content).toContain("line 099");
    expect(content).not.toContain("line 000");
    expect(content.trimEnd().endsWith("```")).toBe(true);
  });

  it("leaves a short tail untouched", async () => {
    vi.mocked(tailLog).mockResolvedValue("[12:00:00] [Server thread/INFO]: hello");
    const { i, editReply } = makeInteraction();
    await execute(i);
    const { content } = editReply.mock.calls[0]![0] as { content: string };
    expect(content).toContain("hello");
    expect(content).not.toContain("…");
  });
});
