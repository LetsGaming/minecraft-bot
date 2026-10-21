// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import InputNumber from "primevue/inputnumber";
import Checkbox from "primevue/checkbox";

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});
vi.mock("../../../src/web/frontend/src/composables/useCapabilities", () => ({
  useCapabilities: () => ({ can: () => true, serversWith: (_cap: string, ids: string[]) => ids }),
}));

import { REWARDS_CONTEXT } from "../../../src/web/frontend/src/composables/rewardsContext";
import { useDailyRewards } from "../../../src/web/frontend/src/composables/useDailyRewards";
import { clearDirtySources } from "../../../src/web/frontend/src/composables/useUnsavedGuard";
import PoolTable from "../../../src/web/frontend/src/components/rewards/PoolTable.vue";
import StreakTimeline from "../../../src/web/frontend/src/components/rewards/StreakTimeline.vue";
import DayPanel from "../../../src/web/frontend/src/components/rewards/DayPanel.vue";
import ClaimPreview from "../../../src/web/frontend/src/components/rewards/ClaimPreview.vue";
import OutcomeStrip from "../../../src/web/frontend/src/components/rewards/OutcomeStrip.vue";
import AddItemDialog from "../../../src/web/frontend/src/components/rewards/AddItemDialog.vue";
import ItemPicker from "../../../src/web/frontend/src/components/rewards/ItemPicker.vue";
import { sharePercent, totalWeight } from "@mcbot/schema/dailyRewards.js";
import SharedImpactDialog from "../../../src/web/frontend/src/components/rewards/SharedImpactDialog.vue";
import RewardsView from "../../../src/web/frontend/src/views/RewardsView.vue";
import { uiGlobal } from "./mountUi";

const SHARED = {
  default: [
    { id: "st", item: "stone", amount: 64, weight: 10 },
    { id: "ir", item: "iron_ingot", amount: 8, weight: 30 },
    { id: "d1", item: "diamond", amount: 1, weight: 40 },
    { id: "d64", item: "diamond", amount: 64, weight: 20 },
  ],
  streakBonuses: {
    "3": [{ id: "b", item: "bread", amount: 4 }],
    "14": [{ id: "g", item: "golden_apple", amount: 2 }],
  },
  bonusChance: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  clearDirtySources();
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/rewards") {
      return { shared: { pool: structuredClone(SHARED), problems: [], hash: "h1", exists: true }, shipped: null };
    }
    return {
      override: { pool: {}, problems: [], hash: "o1", exists: true },
      shared: { pool: structuredClone(SHARED), problems: [] },
    };
  });
  net.apiSend.mockResolvedValue({ hash: "next" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function context(scope = "") {
  const rewards = useDailyRewards();
  await rewards.open(scope);
  return { rewards, catalog: ref(null), editable: ref(true), mode: ref<"percent" | "weight">("percent") };
}

async function mountWith<C extends object>(component: C, props: Record<string, unknown> = {}, scope = ""): Promise<{ wrapper: VueWrapper; ctx: Awaited<ReturnType<typeof context>> }> {
  const ctx = await context(scope);
  const wrapper = mount(component, {
    props,
    attachTo: document.body,
    global: { ...uiGlobal, provide: { [REWARDS_CONTEXT as symbol]: ctx } },
  });
  await flushPromises();
  return { wrapper, ctx };
}

const names = (wrapper: VueWrapper): string[] => wrapper.findAll(".rw-item-name").map((n) => n.text());

describe("PoolTable", () => {
  it("lists every entry, including two for the same item, one line each", async () => {
    const { wrapper } = await mountWith(PoolTable);
    expect(names(wrapper)).toEqual(["Stone", "Iron Ingot", "Diamond", "Diamond"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(4);
  });

  it("filters by text and by rarity, and sorts", async () => {
    const { wrapper } = await mountWith(PoolTable);
    await wrapper.get("#rw-filter").setValue("diam");
    expect(names(wrapper)).toEqual(["Diamond", "Diamond"]);
    await wrapper.get("#rw-filter").setValue("");

    const chip = wrapper.findAll(".pt-chip")[0]!;
    await chip.trigger("click");
    expect(chip.attributes("aria-pressed")).toBe("true");
    await chip.trigger("click");

    (wrapper.vm as unknown as { $: { setupState: { sortField: string; sortDir: number } } }).$.setupState.sortField = "amount";
    (wrapper.vm as unknown as { $: { setupState: { sortField: string; sortDir: number } } }).$.setupState.sortDir = -1;
    await flushPromises();
    expect(wrapper.findAll(".rw-item-name").map((n) => n.text())[0]).toBe("Stone");
  });

  it("edits through the composable and removes a row", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable);
    const amount = wrapper.findAllComponents(InputNumber)[0]!;
    amount.vm.$emit("update:modelValue", 32);
    expect(ctx.rewards.items.value[0]!.amount).toBe(32);

    await wrapper.get("button[aria-label='Remove Stone']").trigger("click");
    expect(names(wrapper)).toEqual(["Iron Ingot", "Diamond", "Diamond"]);
  });

  it("marks what a server changed and lets it bring an entry back", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable, {}, "smp");
    await wrapper.get("button[aria-label='Remove Iron Ingot']").trigger("click");
    const row = wrapper.findAll("tbody tr")[1]!;
    expect(row.classes()).toContain("is-removed");
    expect(row.text()).toContain("Not used here");

    await row.get("button[aria-label='Use Iron Ingot again']").trigger("click");
    expect(wrapper.findAll("tr.is-removed")).toHaveLength(0);
    expect(ctx.rewards.dirty.value).toBe(false);
  });

  it("shows only the differences when asked", async () => {
    const { wrapper } = await mountWith(PoolTable, {}, "smp");
    await wrapper.get("button[aria-label='Remove Stone']").trigger("click");
    const diff = wrapper.findAll(".pt-chip").find((c) => c.text().includes("Differences"))!;
    await diff.trigger("click");
    expect(names(wrapper)).toEqual(["Stone"]);
  });
});

describe("StreakTimeline and DayPanel", () => {
  it("lists the milestones in order and selects one", async () => {
    const { wrapper } = await mountWith(StreakTimeline, { selected: null });
    const chips = wrapper.findAll(".st-chip");
    expect(chips.map((c) => c.find(".st-day").text())).toEqual(["Day 3", "Day 14"]);
    await chips[1]!.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["14"]]);
  });

  it("moves between milestones with the arrow keys", async () => {
    const { wrapper } = await mountWith(StreakTimeline, { selected: null });
    const chips = wrapper.findAll(".st-chip");
    expect(chips[0]!.attributes("tabindex")).toBe("0");
    expect(chips[1]!.attributes("tabindex")).toBe("-1");
    await wrapper.get(".st-list").trigger("keydown", { key: "ArrowRight" });
    await flushPromises();
    expect(wrapper.findAll(".st-chip")[1]!.attributes("tabindex")).toBe("0");
    expect(document.activeElement).toBe(wrapper.findAll(".st-chip")[1]!.element);
  });

  it("adds a day and refuses one that exists", async () => {
    const { wrapper } = await mountWith(StreakTimeline, { selected: null });
    const input = wrapper.findAllComponents(InputNumber)[0]!;
    input.vm.$emit("update:modelValue", 20);
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("select")).toEqual([["20"]]);

    input.vm.$emit("update:modelValue", 14);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[role='alert']").text()).toContain("Day 14 already exists");
  });

  it("edits the selected day's items in the panel", async () => {
    const { wrapper, ctx } = await mountWith(DayPanel, { selected: "14" });
    expect(wrapper.get("h2").text()).toBe("Day 14");
    await wrapper.get("button[aria-label='Remove Golden Apple']").trigger("click");
    expect(ctx.rewards.effectivePool.value.streakBonuses!["14"]).toEqual([]);
    expect(wrapper.get("[role='alert']").text()).toContain("No items on this day");
  });
});

function submitAdd(): void {
  document.getElementById("rw-add-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("adding an item", () => {
  it("opens a dialog with the defaults filled in and adds nothing yet", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable);
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "golden_apple");
    await flushPromises();
    expect(ctx.rewards.items.value).toHaveLength(4);
    const inputs = wrapper.findComponent(AddItemDialog).findAllComponents(InputNumber);
    expect(inputs[0]!.props("modelValue")).toBe(1);
    // The average weight (25) next to a total of 100 is a 20 % share.
    expect(inputs[1]!.props("modelValue")).toBe(20);
    expect(document.body.textContent).toContain("Add Golden Apple");
  });

  it("adds the item with the amount and chance that were chosen", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable);
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "golden_apple");
    await flushPromises();
    const inputs = wrapper.findComponent(AddItemDialog).findAllComponents(InputNumber);
    inputs[0]!.vm.$emit("update:modelValue", 16);
    inputs[1]!.vm.$emit("update:modelValue", 50);
    await flushPromises();
    submitAdd();
    await flushPromises();

    const added = ctx.rewards.items.value.at(-1)!;
    expect(added).toMatchObject({ item: "golden_apple", amount: 16 });
    expect(sharePercent(added.weight!, totalWeight(ctx.rewards.items.value))).toBeCloseTo(50, 2);
    expect(wrapper.findComponent(AddItemDialog).props("item")).toBeNull();
  });

  it("asks for a weight in weight mode", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable);
    ctx.mode.value = "weight";
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "golden_apple");
    await flushPromises();
    const inputs = wrapper.findComponent(AddItemDialog).findAllComponents(InputNumber);
    expect(inputs[1]!.props("modelValue")).toBe(25);
    inputs[1]!.vm.$emit("update:modelValue", 7);
    await flushPromises();
    submitAdd();
    await flushPromises();
    expect(ctx.rewards.items.value.at(-1)).toMatchObject({ item: "golden_apple", weight: 7 });
  });

  it("adds nothing when cancelled", async () => {
    const { wrapper, ctx } = await mountWith(PoolTable);
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "golden_apple");
    await flushPromises();
    [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Cancel"))!.click();
    await flushPromises();
    expect(ctx.rewards.items.value).toHaveLength(4);
    expect(wrapper.findComponent(AddItemDialog).props("item")).toBeNull();
  });

  it("warns when the item is already in the list", async () => {
    const { wrapper } = await mountWith(PoolTable);
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "diamond");
    await flushPromises();
    expect(document.body.textContent).toContain("Diamond is already in this list");
  });

  it("asks only for an amount when adding to a streak day", async () => {
    const { wrapper, ctx } = await mountWith(DayPanel, { selected: "14" });
    wrapper.findComponent(ItemPicker).vm.$emit("pick", "bread");
    await flushPromises();
    const inputs = wrapper.findComponent(AddItemDialog).findAllComponents(InputNumber);
    expect(inputs).toHaveLength(1);
    inputs[0]!.vm.$emit("update:modelValue", 5);
    await flushPromises();
    submitAdd();
    await flushPromises();
    expect(ctx.rewards.effectivePool.value.streakBonuses!["14"]!.at(-1)).toMatchObject({ item: "bread", amount: 5 });
  });
});

describe("OutcomeStrip and ClaimPreview", () => {
  it("shows the chance of each rarity as text as well as a bar", async () => {
    const { wrapper } = await mountWith(OutcomeStrip);
    expect(wrapper.find(".sb-bar").exists()).toBe(true);
    expect(wrapper.findAll(".sb-item")).toHaveLength(5);
    expect(wrapper.text()).toContain("4 items in the pool");
    expect(wrapper.text()).toContain("a second draw on about 1 in 10 claims");
  });

  it("rolls with the same draw the bot uses", async () => {
    const { ctx } = await mountWith(OutcomeStrip);
    const wrapper = mount(ClaimPreview, {
      props: { pool: ctx.rewards.effectivePool.value, catalog: null, rng: () => 0 },
      global: uiGlobal,
    });
    expect(wrapper.text()).toContain("Roll to see");
    await wrapper.get("button[aria-label='Roll']").trigger("click");
    const result = wrapper.get("[role='status']");
    expect(result.text()).toContain("64 × Stone");
    expect(result.text()).toContain("Lucky bonus");
  });

  it("says so when there is nothing to roll from", () => {
    const wrapper = mount(ClaimPreview, { props: { pool: {}, catalog: null }, global: uiGlobal });
    expect(wrapper.text()).toContain("no items to roll from");
  });
});

describe("SharedImpactDialog", () => {
  const servers = [
    {
      serverId: "smp",
      hasOverride: true,
      canEdit: true,
      changes: [
        { where: "default", kind: "removed", id: "ns", before: { item: "netherite_ingot", amount: 64, weight: 0.01 } },
        { where: "default", kind: "added", id: "new", after: { item: "apple", amount: 1, weight: 5 } },
      ],
      orphans: [],
    },
    { serverId: "cre", hasOverride: false, canEdit: false, changes: [{ where: "streakBonuses.14", kind: "removed", id: "g", before: { item: "golden_apple", amount: 2 } }], orphans: [] },
  ] as never;

  it("turns the ticked boxes into keep and exclude choices for the servers that may be edited", async () => {
    const wrapper = mount(SharedImpactDialog, {
      props: { visible: true, servers, catalog: null },
      attachTo: document.body,
      global: uiGlobal,
    });
    await flushPromises();
    const boxes = wrapper.findAllComponents(Checkbox);
    expect(boxes).toHaveLength(3);
    expect(boxes[2]!.props("disabled")).toBe(true);

    boxes[0]!.vm.$emit("update:modelValue", true);
    boxes[1]!.vm.$emit("update:modelValue", true);
    boxes[2]!.vm.$emit("update:modelValue", true);
    await flushPromises();

    const save = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Save and apply choices"))!;
    save.click();
    expect(wrapper.emitted("confirm")).toEqual([[{ smp: { keep: { pool: ["ns"] }, exclude: { pool: ["new"] } } }]]);
  });

  it("changes nothing when no box is ticked", async () => {
    const wrapper = mount(SharedImpactDialog, { props: { visible: true, servers, catalog: null }, attachTo: document.body, global: uiGlobal });
    await flushPromises();
    [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Save and apply choices"))!.click();
    expect(wrapper.emitted("confirm")).toEqual([[{}]]);
  });
});

describe("RewardsView", () => {
  it("opens the shared pool with the outcome strip, the tabs and a clean edit bar", async () => {
    const wrapper = mount(RewardsView, { props: { serverIds: ["smp"], server: "" }, attachTo: document.body, global: uiGlobal });
    await flushPromises();
    expect(wrapper.text()).toContain("What players get");
    expect(wrapper.findAll("[role='tab']").map((t) => t.text())).toEqual(["Item pool", "Streak milestones", "Bonus chance"]);
    expect(wrapper.find(".edit-bar").classes()).toContain("is-clean");
    expect(names(wrapper)).toHaveLength(4);
  });

  it("stays clean after focusing and leaving every number field", async () => {
    const wrapper = mount(RewardsView, { props: { serverIds: ["smp"], server: "" }, attachTo: document.body, global: uiGlobal });
    await flushPromises();
    for (const input of wrapper.findAll("input.p-inputnumber-input")) {
      await input.trigger("focus");
      await input.trigger("blur");
    }
    expect(wrapper.find(".edit-bar").classes()).toContain("is-clean");
  });

  it("switches tabs and remembers the choice", async () => {
    const wrapper = mount(RewardsView, { props: { serverIds: ["smp"], server: "" }, attachTo: document.body, global: uiGlobal });
    await flushPromises();
    await wrapper.findAll("[role='tab']")[1]!.trigger("click");
    expect(wrapper.find(".st-list").exists()).toBe(true);
    expect(localStorage.getItem("mcbot.rewards.tab")).toBe("streaks");
    localStorage.removeItem("mcbot.rewards.tab");
  });
});
