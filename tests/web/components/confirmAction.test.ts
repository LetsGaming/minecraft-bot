// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import TypedConfirmDialog from "../../../src/web/frontend/src/components/ui/TypedConfirmDialog.vue";
import {
  useConfirmAction,
  type ConfirmActionOptions,
  type ConfirmResult,
} from "../../../src/web/frontend/src/composables/useConfirmAction";
import { useRowBusy } from "../../../src/web/frontend/src/composables/useRowBusy";
import { uiGlobal, settle } from "./mountUi";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

function host() {
  let confirmAction!: ReturnType<typeof useConfirmAction>;
  const Host = defineComponent({
    setup() {
      confirmAction = useConfirmAction();
      return () => h("div", [h("button", { id: "opener" }, "Restore"), h(TypedConfirmDialog)]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  const opener = document.getElementById("opener") as HTMLButtonElement;
  return {
    opener,
    async open(options: ConfirmActionOptions): Promise<{ result: Promise<ConfirmResult> }> {
      opener.focus();
      const result = confirmAction(options);
      await settle();
      return { result };
    },
  };
}

function dialog(): HTMLElement {
  return document.querySelector('[role="alertdialog"]') as HTMLElement;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

async function type(text: string): Promise<void> {
  const input = document.getElementById("typed-confirm") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await settle(5);
}

const irreversible: ConfirmActionOptions = {
  level: "irreversible",
  header: "Delete smp-daily-2026-10-09_03-00?",
  message: "The backup file (3.72 GB) is removed from the host. It cannot be recovered.",
  acceptLabel: "Delete backup",
  expected: "delete",
  facts: [{ term: "Recover", detail: "Not possible." }],
};

describe("useConfirmAction on the shared dialog", () => {
  it("focuses the typed input, unlocks only on the exact text, and resolves confirm", async () => {
    const ui = host();
    const { result } = await ui.open(irreversible);
    expect(document.activeElement?.id).toBe("typed-confirm");
    expect(dialog().querySelector("label")?.getAttribute("for")).toBe("typed-confirm");
    expect(button("Delete backup").disabled).toBe(true);
    await type("delet");
    expect(button("Delete backup").disabled).toBe(true);
    await type("delete");
    expect(button("Delete backup").disabled).toBe(false);
    button("Delete backup").click();
    expect(await result).toBe("confirm");
  });

  it("names the dialog by its heading and lists the facts", async () => {
    const ui = host();
    await ui.open(irreversible);
    const labelledBy = dialog().getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Delete smp-daily-2026-10-09_03-00?");
    expect(dialog().querySelector("dt")?.textContent).toBe("Recover");
  });

  it("returns focus to the opener when cancelled", async () => {
    const ui = host();
    const { result } = await ui.open(irreversible);
    button("Cancel").click();
    expect(await result).toBe("cancel");
    await settle();
    expect(document.activeElement).toBe(ui.opener);
  });

  it("keeps a blocked action off, says why and offers the way out", async () => {
    const ui = host();
    const { result } = await ui.open({
      ...irreversible,
      expected: "smp",
      blockedReason: "smp is online with 3 players.",
      alternateLabel: "Open Servers to stop smp",
    });
    expect(document.getElementById("typed-confirm")).toBeNull();
    expect(dialog().textContent).toContain("smp is online with 3 players.");
    expect(button("Delete backup").disabled).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    button("Open Servers to stop smp").click();
    expect(await result).toBe("alternate");
  });

  it("focuses Cancel for a disruptive action", async () => {
    const ui = host();
    const { result } = await ui.open({ level: "disruptive", header: "Stop smp?", message: "m", acceptLabel: "Stop" });
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    expect(button("Stop").disabled).toBe(false);
    button("Stop").click();
    expect(await result).toBe("confirm");
  });

  it("refuses an irreversible confirm with nothing to type", () => {
    host();
    const { expected: _omit, ...rest } = irreversible;
    let confirmAction!: ReturnType<typeof useConfirmAction>;
    mount(defineComponent({ setup() { confirmAction = useConfirmAction(); return () => null; } }), { global: uiGlobal });
    expect(() => confirmAction(rest)).toThrow();
  });
});

describe("useRowBusy", () => {
  it("marks one row busy and leaves the others usable", async () => {
    const busy = useRowBusy<string>();
    let finish!: () => void;
    const running = busy.run("a", () => new Promise<void>((r) => (finish = r)), { label: "Deleting" });
    expect(busy.isBusy("a")).toBe(true);
    expect(busy.busyLabel("a")).toBe("Deleting");
    expect(busy.isLocked("b")).toBe(false);
    finish();
    await running;
    expect(busy.isBusy("a")).toBe(false);
    expect(busy.anyBusy.value).toBe(false);
  });

  it("locks every other row during an exclusive run and clears on failure", async () => {
    const busy = useRowBusy<string>();
    const failing = busy.run("a", async () => {
      expect(busy.isLocked("b")).toBe(true);
      throw new Error("boom");
    }, { exclusive: true });
    await expect(failing).rejects.toThrow("boom");
    expect(busy.isLocked("b")).toBe(false);
    expect(busy.exclusiveKey.value).toBeNull();
  });
});
