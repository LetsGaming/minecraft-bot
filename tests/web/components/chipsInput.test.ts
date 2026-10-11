// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, provide, ref } from "vue";
import ChipsInput from "../../../src/web/frontend/src/components/ui/ChipsInput.vue";
import { chipsInputPt, splitEntries } from "../../../src/web/frontend/src/components/ui/chipsA11y";
import SchemaField from "../../../src/web/frontend/src/components/schema/SchemaField.vue";
import { SchemaFormKey, type SchemaFormContext } from "../../../src/web/frontend/src/composables/useSchemaForm";
import { uiGlobal } from "./mountUi";

type Wrapper = ReturnType<typeof mount>;

function mountChips(props: Record<string, unknown> = {}) {
  return mount(ChipsInput, {
    props: { modelValue: [], inputId: "f", labelledby: "f-label", ...props },
    global: uiGlobal,
    attachTo: document.body,
  });
}

function lastEmit(w: Wrapper): unknown {
  return w.emitted("update:model-value")?.at(-1)?.[0];
}

function paste(w: Wrapper, text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  w.find("input").element.dispatchEvent(event);
  return event;
}

describe("splitEntries", () => {
  it("trims and drops empty entries", () => {
    expect(splitEntries(" a, b,,c , ", ",")).toEqual(["a", "b", "c"]);
    expect(splitEntries("   ", ",")).toEqual([]);
  });
});

describe("chipsInputPt", () => {
  it("strips the combobox and listbox roles PrimeVue puts on a typeahead-free box", () => {
    const pt = chipsInputPt({ describedby: "x-help" });
    expect(pt.inputMultiple.role).toBe("list");
    expect(pt.chipItem.role).toBe("listitem");
    expect(pt.inputChip.role).toBe("listitem");
    expect(pt.input.role).toBeNull();
    expect(pt.input["aria-controls"]).toBeNull();
    expect(pt.input["aria-describedby"]).toBe("x-help");
  });
});

describe("ChipsInput", () => {
  // jsdom has no matchMedia; PrimeVue's AutoComplete asks for one.
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without PrimeVue's deprecation warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountChips({ modelValue: ["a"] }).unmount();
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/deprecated/i);
  });

  it("renders a labelled list of entries with a plain text box and named remove buttons", () => {
    const w = mountChips({ modelValue: ["alpha", "beta"], describedby: "f-help" });
    const list = w.find("ul");
    expect(list.attributes("role")).toBe("list");
    expect(list.attributes("aria-orientation")).toBeUndefined();
    const items = list.findAll("li");
    expect(items.map((li) => li.attributes("role"))).toEqual(["listitem", "listitem", "listitem"]);
    expect(items[0]!.attributes("aria-selected")).toBeUndefined();
    const input = w.find("input");
    expect(input.attributes("id")).toBe("f");
    expect(input.attributes("aria-labelledby")).toBe("f-label");
    expect(input.attributes("aria-describedby")).toBe("f-help");
    expect(input.attributes("role")).toBeUndefined();
    expect(input.attributes("aria-controls")).toBeUndefined();
    expect(input.attributes("aria-expanded")).toBeUndefined();
    const removes = w.findAll("button.chips-remove");
    expect(removes.map((b) => b.attributes("aria-label"))).toEqual(["Remove alpha", "Remove beta"]);
    w.unmount();
  });

  it("adds the typed entry on Enter, keeping duplicates", async () => {
    const w = mountChips({ modelValue: ["a"] });
    const input = w.find("input");
    input.element.value = "  a ";
    await input.trigger("keydown", { key: "Enter", code: "Enter" });
    expect(lastEmit(w)).toEqual(["a", "a"]);
    expect(input.element.value).toBe("");
    w.unmount();
  });

  it("shows only what the parent kept when it ignores an added entry", async () => {
    const w = mountChips({ modelValue: ["a"] });
    const input = w.find("input");
    input.element.value = "rejected";
    await input.trigger("keydown", { key: "Enter", code: "Enter" });
    await nextTick();
    expect(w.findAll(".p-chip-label").map((c) => c.text())).toEqual(["a"]);
    w.unmount();
  });

  it("ignores Enter on an empty box", async () => {
    const w = mountChips({ modelValue: ["a"] });
    await w.find("input").trigger("keydown", { key: "Enter", code: "Enter" });
    expect(w.emitted("update:model-value")).toBeUndefined();
    w.unmount();
  });

  it("adds the typed entry on the separator and does not type it", async () => {
    const w = mountChips({ modelValue: ["a"], separator: "," });
    const input = w.find("input");
    input.element.value = "b";
    const event = new KeyboardEvent("keydown", { key: ",", code: "Comma", bubbles: true, cancelable: true });
    input.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(lastEmit(w)).toEqual(["a", "b"]);
    expect(input.element.value).toBe("");
    w.unmount();
  });

  it("types the separator as text when the field has none", async () => {
    const w = mountChips({ modelValue: [] });
    const input = w.find("input");
    input.element.value = "b";
    const event = new KeyboardEvent("keydown", { key: ",", code: "Comma", bubbles: true, cancelable: true });
    input.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(w.emitted("update:model-value")).toBeUndefined();
    w.unmount();
  });

  it("splits pasted text on the separator", () => {
    const w = mountChips({ modelValue: ["a"], separator: "," });
    w.find("input").element.value = "b";
    const event = paste(w, "c, d,,e");
    expect(event.defaultPrevented).toBe(true);
    expect(lastEmit(w)).toEqual(["a", "bc", "d", "e"]);
    w.unmount();
  });

  it("leaves a paste without the separator to the browser", () => {
    const w = mountChips({ modelValue: [], separator: "," });
    const event = paste(w, "single");
    expect(event.defaultPrevented).toBe(false);
    expect(w.emitted("update:model-value")).toBeUndefined();
    w.unmount();
  });

  it("removes the last entry on Backspace in the empty box", async () => {
    const w = mountChips({ modelValue: ["a", "b"] });
    await w.find("input").trigger("keydown", { key: "Backspace", code: "Backspace" });
    expect(lastEmit(w)).toEqual(["a"]);
    w.unmount();
  });

  it("removes an entry through its remove button", async () => {
    const w = mountChips({ modelValue: ["a", "b", "c"] });
    await w.findAll("button.chips-remove")[1]!.trigger("click");
    expect(lastEmit(w)).toEqual(["a", "c"]);
    w.unmount();
  });

  it("disables the box and the remove buttons", () => {
    const w = mountChips({ modelValue: ["a"], disabled: true });
    expect(w.find("input").attributes("disabled")).toBeDefined();
    expect(w.find("button.chips-remove").attributes("disabled")).toBeDefined();
    w.unmount();
  });
});

function contextWith(over: Partial<SchemaFormContext> = {}): SchemaFormContext {
  return {
    isVisible: () => true,
    filtering: () => false,
    baselineAt: () => ({ known: false, value: undefined }),
    errorFor: () => "",
    hasProblemUnder: () => false,
    conflictAt: () => false,
    isRevealed: () => false,
    locked: () => false,
    isSecret: () => false,
    idFor: (path) => `t-${path.join("-")}`,
    ...over,
  };
}

/** Mounts a field whose host stores what it emits, as the editor does. */
function mountField(props: Record<string, unknown>, context: SchemaFormContext) {
  const value = ref<unknown>(props.modelValue);
  const Host = defineComponent({
    setup() {
      provide(SchemaFormKey, context);
      return () =>
        h(SchemaField, {
          ...props,
          modelValue: value.value,
          "onUpdate:model-value": (next: unknown) => (value.value = next),
        });
    },
  });
  return { w: mount(Host, { global: uiGlobal, attachTo: document.body }), value };
}

function chipTexts(w: Wrapper): string[] {
  return w.findAll(".p-chip-label").map((c) => c.text());
}

describe("SchemaField list fields", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("ties a string list to its label, error and old value", async () => {
    const { w, value } = mountField(
      { name: "admins", schema: { type: "array", items: { type: "string" } }, keyPath: ["admins"], modelValue: ["a", "b"] },
      contextWith({ baselineAt: () => ({ known: true, value: ["a"] }), errorFor: () => "Too many." }),
    );
    const input = w.find("input#t-admins");
    expect(input.exists()).toBe(true);
    expect(input.attributes("aria-labelledby")).toBe("t-admins-label");
    expect(input.attributes("aria-describedby")).toContain("t-admins-error");
    expect(w.find(".p-autocomplete").classes()).toContain("p-invalid");
    expect(w.find(".field-row").classes()).toContain("dirty");
    expect(w.find(".sf-was").text()).toContain('["a"]');
    input.element.value = "c";
    await input.trigger("keydown", { key: ",", code: "Comma" });
    expect(value.value).toEqual(["a", "b", "c"]);
    await nextTick();
    expect(chipTexts(w)).toEqual(["a", "b", "c"]);
    w.unmount();
  });

  it("stores numbers for a number list, drops non-numbers and unsets it when emptied", async () => {
    const { w, value } = mountField(
      { name: "ports", schema: { type: "array", items: { type: "number" } }, keyPath: ["ports"], modelValue: [25565] },
      contextWith(),
    );
    const input = w.find("input#t-ports");
    input.element.value = "25566";
    await input.trigger("keydown", { key: "Enter", code: "Enter" });
    expect(value.value).toEqual([25565, 25566]);

    input.element.value = "abc";
    await input.trigger("keydown", { key: "Enter", code: "Enter" });
    await nextTick();
    expect(value.value).toEqual([25565, 25566]);
    expect(chipTexts(w)).toEqual(["25565", "25566"]);

    await w.findAll("button.chips-remove")[1]!.trigger("click");
    await w.find("button.chips-remove").trigger("click");
    expect(value.value).toBeUndefined();
    await nextTick();
    expect(chipTexts(w)).toEqual([]);
    w.unmount();
  });
});
