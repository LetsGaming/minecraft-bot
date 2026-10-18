import { describe, it, expect, vi, beforeEach } from "vitest";

const toastAdd = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/usetoast/index.mjs", () => ({
  useToast: () => ({ add: toastAdd }),
}));

import { useNotify, TOAST_LIFE_MS } from "../../src/web/frontend/src/composables/useNotify.js";

beforeEach(() => {
  toastAdd.mockReset();
});

describe("useNotify", () => {
  it("shows each severity for its own lifetime", () => {
    const notify = useNotify();
    notify.ok("saved", "all good");
    notify.info("queued");
    notify.warn("partial");
    notify.fail("broke", new Error("boom"));
    expect(toastAdd.mock.calls.map((c) => c[0])).toEqual([
      { severity: "success", summary: "saved", detail: "all good", life: TOAST_LIFE_MS.success },
      { severity: "info", summary: "queued", life: TOAST_LIFE_MS.info },
      { severity: "warn", summary: "partial", life: TOAST_LIFE_MS.warn },
      { severity: "error", summary: "broke", detail: "boom", life: TOAST_LIFE_MS.error },
    ]);
  });

  it("failures stay on screen longer than successes", () => {
    expect(TOAST_LIFE_MS.error).toBeGreaterThan(TOAST_LIFE_MS.success);
  });

  it("fail accepts a ready message as the cause", () => {
    useNotify().fail("broke", "already text");
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: "already text" }));
  });
});
