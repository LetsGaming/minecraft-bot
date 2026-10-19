// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import TabList from "../../../src/web/frontend/src/components/ui/TabList.vue";

let wrapper: VueWrapper | null = null;

function mountTabs(props: Partial<{ modelValue: string; tabs: Array<{ id: string; label: string; disabled?: boolean }> }> = {}) {
  wrapper = mount(TabList, {
    attachTo: document.body,
    props: {
      tabs: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      modelValue: "a",
      label: "Sections",
      idPrefix: "t",
      panelId: "panel",
      ...props,
    },
  });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("TabList", () => {
  it("marks the selected tab and keeps only it in the tab order", () => {
    const w = mountTabs({ modelValue: "b" });
    const tabs = w.findAll('[role="tab"]');
    expect(tabs.map((t) => t.attributes("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((t) => t.attributes("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(tabs[0]!.attributes("id")).toBe("t-tab-a");
    expect(tabs[0]!.attributes("aria-controls")).toBe("panel");
    expect(w.find('[role="tablist"]').attributes("aria-label")).toBe("Sections");
  });

  it("selects on click", async () => {
    const w = mountTabs();
    await w.findAll('[role="tab"]')[2]!.trigger("click");
    expect(w.emitted("select")?.[0]).toEqual(["c"]);
  });

  it("moves with the arrow keys, wrapping at both ends, and with Home and End", async () => {
    const w = mountTabs({ modelValue: "c" });
    const list = w.find('[role="tablist"]');
    await list.trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("select")?.[0]).toEqual(["a"]);
    await list.trigger("keydown", { key: "ArrowLeft" });
    expect(w.emitted("select")?.[1]).toEqual(["b"]);
    await list.trigger("keydown", { key: "Home" });
    expect(w.emitted("select")?.[2]).toEqual(["a"]);
    await list.trigger("keydown", { key: "End" });
    expect(w.emitted("select")).toHaveLength(3);
  });

  it("skips a disabled tab and does nothing when no other tab is enabled", async () => {
    const w = mountTabs({
      tabs: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta", disabled: true },
        { id: "c", label: "Gamma" },
      ],
    });
    await w.find('[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("select")?.[0]).toEqual(["c"]);

    const lone = mountTabs({ tabs: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta", disabled: true }] });
    await lone.find('[role="tablist"]').trigger("keydown", { key: "ArrowRight" });
    expect(lone.emitted("select")).toBeUndefined();
  });

  it("ignores other keys", async () => {
    const w = mountTabs();
    await w.find('[role="tablist"]').trigger("keydown", { key: "x" });
    expect(w.emitted("select")).toBeUndefined();
  });
});
