import { describe, it, expect, vi } from "vitest";

const require_ = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/useconfirm/index.mjs", () => ({
  useConfirm: () => ({ require: require_ }),
}));

import {
  useTypedConfirm,
  typedExpected,
  typedNonce,
  TYPED_CONFIRM_GROUP,
} from "../../src/web/frontend/src/composables/useTypedConfirm.js";

const options = {
  header: "Restore backup",
  message: "This replaces the world.",
  expected: "smp",
  acceptLabel: "Restore",
};

describe("useTypedConfirm", () => {
  it("opens the typed dialog with the expected name and a fresh nonce", () => {
    const confirmTyped = useTypedConfirm();
    const before = typedNonce.value;
    void confirmTyped(options);
    expect(typedExpected.value).toBe("smp");
    expect(typedNonce.value).toBe(before + 1);
    expect(require_).toHaveBeenLastCalledWith(
      expect.objectContaining({ group: TYPED_CONFIRM_GROUP, header: "Restore backup" }),
    );
  });

  it("resolves true on accept, false on reject and on dismiss", async () => {
    const confirmTyped = useTypedConfirm();

    const accepted = confirmTyped(options);
    require_.mock.calls.at(-1)![0].accept();
    expect(await accepted).toBe(true);

    const rejected = confirmTyped(options);
    require_.mock.calls.at(-1)![0].reject();
    expect(await rejected).toBe(false);

    const dismissed = confirmTyped(options);
    require_.mock.calls.at(-1)![0].onHide();
    expect(await dismissed).toBe(false);
  });
});
