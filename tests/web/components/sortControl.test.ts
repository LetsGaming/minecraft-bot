// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import SortControl from "../../../src/web/frontend/src/components/ui/SortControl.vue";
import { uiGlobal } from "./mountUi";

const options = [
  { field: "name", label: "Player" },
  { field: "playtimeMs", label: "Playtime" },
];

describe("SortControl", () => {
  // jsdom has no matchMedia; PrimeVue's Select asks for one on mount.
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names its picker by the visible label, not by the picked value", () => {
    const w = mount(SortControl, { props: { field: "playtimeMs", order: -1, options }, global: uiGlobal });
    const label = w.find("label");
    const combo = w.find("[role=combobox]");
    expect(combo.attributes("aria-labelledby")).toBe(label.attributes("id"));
    expect(label.text()).toBe("Sort by");
  });

  it("flips the order and says which order is active", async () => {
    const w = mount(SortControl, { props: { field: "name", order: -1, options }, global: uiGlobal });
    const button = w.find("button");
    expect(button.attributes("aria-label")).toBe("Sort order: Descending");
    await button.trigger("click");
    expect(w.emitted("update:order")).toEqual([[1]]);
  });
});
