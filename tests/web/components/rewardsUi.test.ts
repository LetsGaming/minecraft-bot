// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import SidePanel from "../../../src/web/frontend/src/components/ui/SidePanel.vue";
import StackedBar from "../../../src/web/frontend/src/components/ui/StackedBar.vue";
import UndoBar from "../../../src/web/frontend/src/components/rewards/UndoBar.vue";
import { uiGlobal } from "./mountUi";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function stubSheet(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const panelProps = { modelValue: true, label: "Day 14", closeLabel: "Close" };

describe("SidePanel", () => {
  it("is not rendered while closed", () => {
    const wrapper = mount(SidePanel, { props: { ...panelProps, modelValue: false }, global: uiGlobal });
    expect(wrapper.find("aside").exists()).toBe(false);
  });

  it("names itself by its heading and closes with the button and Escape", async () => {
    const wrapper = mount(SidePanel, { props: panelProps, slots: { default: "<p>body</p>" }, global: uiGlobal });
    const aside = wrapper.get("aside");
    expect(aside.attributes("role")).toBe("dialog");
    expect(wrapper.get("h2").text()).toBe("Day 14");
    expect(aside.attributes("aria-labelledby")).toBe(wrapper.get("h2").attributes("id"));

    await wrapper.get("button[aria-label='Close']").trigger("click");
    await aside.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:modelValue")).toEqual([[false], [false]]);
  });

  it("sits inline on a wide screen and does not cover the page", () => {
    stubSheet(false);
    const wrapper = mount(SidePanel, { props: panelProps, global: uiGlobal });
    expect(wrapper.find(".sp-scrim").exists()).toBe(false);
    expect(wrapper.get("aside").attributes("aria-modal")).toBe("false");
  });

  it("becomes a modal sheet on a narrow screen, closes from the scrim and keeps Tab inside", async () => {
    stubSheet(true);
    const wrapper = mount(SidePanel, {
      props: panelProps,
      slots: { default: "<button id='inner'>inner</button>" },
      attachTo: document.body,
      global: uiGlobal,
    });
    await nextTick();
    expect(wrapper.get("aside").attributes("aria-modal")).toBe("true");

    const inner = document.getElementById("inner")!;
    inner.focus();
    await wrapper.get("aside").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get(".sp-close").element);

    await wrapper.get(".sp-scrim").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it("returns focus to what opened it", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(SidePanel, { props: { ...panelProps, modelValue: false }, attachTo: document.body, global: uiGlobal });
    await wrapper.setProps({ modelValue: true });
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get("aside").element);
    await wrapper.setProps({ modelValue: false });
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
  });
});

describe("StackedBar", () => {
  const segments = [
    { key: "common", label: "Common", share: 80, text: "80 %", color: "var(--a)" },
    { key: "epic", label: "Epic", share: 20, text: "20 %", color: "var(--b)" },
    { key: "legendary", label: "Legendary", share: 0, text: "0 %", color: "var(--c)" },
  ];

  it("draws a segment per non-empty share and lists every share as text", () => {
    const wrapper = mount(StackedBar, { props: { segments, label: "Chances by rarity" }, global: uiGlobal });
    expect(wrapper.findAll(".sb-seg")).toHaveLength(2);
    expect(wrapper.get("[role='img']").attributes("aria-label")).toBe("Chances by rarity");
    expect(wrapper.findAll(".sb-item").map((li) => li.text())).toEqual(["Common80 %", "Epic20 %", "Legendary0 %"]);
  });
});

describe("UndoBar", () => {
  const props = { token: 0, message: "Removed", actionLabel: "Undo" };

  it("shows after an edit, hides on its own, and asks the parent to undo", async () => {
    vi.useFakeTimers();
    const wrapper = mount(UndoBar, { props: { ...props, duration: 1000 }, global: uiGlobal });
    expect(wrapper.find("[role='status']").exists()).toBe(false);

    await wrapper.setProps({ token: 1 });
    expect(wrapper.get("[role='status']").text()).toContain("Removed");

    vi.advanceTimersByTime(1001);
    await nextTick();
    expect(wrapper.find("[role='status']").exists()).toBe(false);

    await wrapper.setProps({ token: 2 });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("undo")).toHaveLength(1);
    expect(wrapper.find("[role='status']").exists()).toBe(false);
  });
});
