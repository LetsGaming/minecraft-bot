/**
 * handlePagination tests — covers the interactive pagination collector logic
 * in embedUtils.ts lines 189-238.
 *
 * Uses the REAL embedUtils (no top-level vi.mock) so the actual code runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

import { handlePagination } from "../src/utils/embedUtils.js";

function makeCollector() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  return {
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    }),
    _trigger: async (event: string, ...args: never[]) => {
      const h = handlers.get(event);
      if (h) await h(...args);
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("handlePagination", () => {
  it("registers both 'collect' and 'end' handlers", async () => {
    const collector = makeCollector();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
      edit: vi.fn(),
    };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{} as never]);
    expect(collector.on).toHaveBeenCalledWith("collect", expect.any(Function));
    expect(collector.on).toHaveBeenCalledWith("end", expect.any(Function));
  });

  it("navigates to next page when 'next' is pressed by the right user", async () => {
    const collector = makeCollector();
    const message = { createMessageComponentCollector: vi.fn().mockReturnValue(collector), edit: vi.fn() };
    const interaction = { user: { id: "u1" }, ephemeral: false };

    await handlePagination(message as never, interaction as never, [{} as never, {} as never]);

    const btn = { user: { id: "u1" }, customId: "next", update: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", btn as never);
    expect(btn.update).toHaveBeenCalled();
  });

  it("navigates to prev page when 'prev' is pressed", async () => {
    const collector = makeCollector();
    const message = { createMessageComponentCollector: vi.fn().mockReturnValue(collector), edit: vi.fn() };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{}, {}, {}] as never);

    // Go to page 1 first
    const next = { user: { id: "u1" }, customId: "next", update: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", next as never);

    // Now go back
    const prev = { user: { id: "u1" }, customId: "prev", update: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", prev as never);
    expect(prev.update).toHaveBeenCalled();
  });

  it("navigates to first page when 'first' is pressed", async () => {
    const collector = makeCollector();
    const message = { createMessageComponentCollector: vi.fn().mockReturnValue(collector), edit: vi.fn() };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{}, {}, {}] as never);

    const btn = { user: { id: "u1" }, customId: "first", update: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", btn as never);
    expect(btn.update).toHaveBeenCalled();
  });

  it("navigates to last page when 'last' is pressed", async () => {
    const collector = makeCollector();
    const message = { createMessageComponentCollector: vi.fn().mockReturnValue(collector), edit: vi.fn() };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{}, {}, {}] as never);

    const btn = { user: { id: "u1" }, customId: "last", update: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", btn as never);
    expect(btn.update).toHaveBeenCalled();
  });

  it("replies with rejection when the wrong user presses a button", async () => {
    const collector = makeCollector();
    const message = { createMessageComponentCollector: vi.fn().mockReturnValue(collector), edit: vi.fn() };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{} as never]);

    const btn = { user: { id: "wronguser" }, customId: "next", reply: vi.fn().mockResolvedValue(undefined) };
    await collector._trigger("collect", btn as never);
    expect(btn.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("aren't for you") }),
    );
  });

  it("removes buttons on 'end' when interaction is not ephemeral", async () => {
    const collector = makeCollector();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
      edit: vi.fn().mockResolvedValue(undefined),
    };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: false } as never, [{} as never]);
    await collector._trigger("end");
    expect(message.edit).toHaveBeenCalledWith({ components: [] });
  });

  it("skips removing buttons on 'end' when interaction IS ephemeral", async () => {
    const collector = makeCollector();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
      edit: vi.fn(),
    };
    await handlePagination(message as never, { user: { id: "u1" }, ephemeral: true } as never, [{} as never]);
    await collector._trigger("end");
    expect(message.edit).not.toHaveBeenCalled();
  });
});
