// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import EditBar from "../../../src/web/frontend/src/components/ui/EditBar.vue";
import EditorShell from "../../../src/web/frontend/src/components/ui/EditorShell.vue";
import FieldRow from "../../../src/web/frontend/src/components/ui/FieldRow.vue";
import ReviewChanges from "../../../src/web/frontend/src/components/ui/ReviewChanges.vue";
import SchemaField from "../../../src/web/frontend/src/components/schema/SchemaField.vue";
import { SchemaFormKey, type SchemaFormContext } from "../../../src/web/frontend/src/composables/useSchemaForm";
import { SECRET_PLACEHOLDER } from "../../../src/schema/config";
import { settle, uiGlobal } from "./mountUi";

function buttons(w: ReturnType<typeof mount>) {
  return w.findAll("button").map((b) => ({ text: b.text(), disabled: b.attributes("disabled") !== undefined }));
}

describe("EditBar", () => {
  it("offers nothing to save when clean", () => {
    const w = mount(EditBar, { props: { state: "clean", changeCount: 0 }, global: uiGlobal });
    expect(w.attributes("role")).toBe("region");
    expect(w.text()).toContain("No unsaved changes");
    expect(buttons(w)).toEqual([{ text: "Nothing to save", disabled: true }]);
  });

  it("shows the editor's own clean status in place of the default", () => {
    const w = mount(EditBar, {
      props: { state: "clean", changeCount: 0 },
      slots: { status: "<span>Applied 14:32</span>" },
      global: uiGlobal,
    });
    expect(w.text()).toContain("Applied 14:32");
    expect(w.text()).not.toContain("No unsaved changes");
  });

  it("counts changes when dirty and emits save, discard and review", async () => {
    const w = mount(EditBar, {
      props: { state: "dirty", changeCount: 3, reviewable: true, saveHint: "Saving writes config.json." },
      global: uiGlobal,
    });
    expect(w.text()).toContain("3 unsaved changes");
    expect(w.text()).toContain("Saving writes config.json.");
    expect(buttons(w)).toEqual([
      { text: "Discard changes", disabled: false },
      { text: "Review changes", disabled: false },
      { text: "Save 3 changes", disabled: false },
    ]);
    const [discard, review, save] = w.findAll("button");
    expect(save!.classes()).toContain("tap");
    await discard!.trigger("click");
    await review!.trigger("click");
    await save!.trigger("click");
    expect(w.emitted("discard")).toHaveLength(1);
    expect(w.emitted("review")).toHaveLength(1);
    expect(w.emitted("save")).toHaveLength(1);
  });

  it("uses the singular for one change", () => {
    const w = mount(EditBar, { props: { state: "dirty", changeCount: 1 }, global: uiGlobal });
    expect(w.text()).toContain("1 unsaved change");
    expect(w.findAll("button").at(-1)!.text()).toBe("Save 1 change");
  });

  it("blocks Save on problems and points at the first one", async () => {
    const w = mount(EditBar, { props: { state: "error", changeCount: 2, problemCount: 1 }, global: uiGlobal });
    expect(w.text()).toContain("1 problem");
    expect(w.findAll("button").at(-1)!.attributes("disabled")).toBeDefined();
    await w.findAll("button").find((b) => b.text() === "Go to first problem")!.trigger("click");
    expect(w.emitted("first-problem")).toHaveLength(1);
  });

  it("blocks Save while a conflict is open", () => {
    const w = mount(EditBar, { props: { state: "conflict", changeCount: 3, conflictCount: 1 }, global: uiGlobal });
    expect(w.text()).toContain("1 conflict");
    expect(w.text()).toContain("Resolve the conflict to save.");
    expect(w.findAll("button").at(-1)!.attributes("disabled")).toBeDefined();
  });

  it("shows saving with a busy chip and no discard", () => {
    const w = mount(EditBar, { props: { state: "saving", changeCount: 2 }, global: uiGlobal });
    expect(w.text()).toContain("Saving 2 changes");
    expect(w.find(".status-chip.busy").exists()).toBe(true);
    expect(buttons(w).map((b) => b.text)).not.toContain("Discard changes");
  });

  it("drops the actions when read-only", () => {
    const w = mount(EditBar, { props: { state: "readonly", changeCount: 0 }, global: uiGlobal });
    expect(w.text()).toContain("Read-only");
    expect(w.findAll("button")).toHaveLength(0);
  });

  it("keeps Save off when the editor says it cannot save", () => {
    const w = mount(EditBar, { props: { state: "dirty", changeCount: 1, canSave: false }, global: uiGlobal });
    expect(w.findAll("button").at(-1)!.attributes("disabled")).toBeDefined();
  });
});

describe("EditorShell", () => {
  it("says why it is read-only, labels the group list and locks the fields", () => {
    const w = mount(EditorShell, {
      props: { state: "readonly", readonlyReason: "Only sysadmins can change config.json." },
      slots: {
        nav: "<a href='#g'>General</a>",
        default: (slot: { locked: boolean }) => h("p", { class: "fields" }, String(slot.locked)),
      },
    });
    expect(w.text()).toContain("Only sysadmins can change config.json.");
    expect(w.find("nav").attributes("aria-label")).toBe("Groups");
    expect(w.find(".fields").text()).toBe("true");
  });

  it("is not locked or busy while dirty", () => {
    const w = mount(EditorShell, {
      props: { state: "dirty" },
      slots: { default: (slot: { locked: boolean }) => h("p", { class: "fields" }, String(slot.locked)) },
    });
    expect(w.attributes("aria-busy")).toBeUndefined();
    expect(w.find(".fields").text()).toBe("false");
    expect(w.text()).not.toContain("Changed by someone else");
  });

  it("shows the conflict banner with the editor's picker and actions", () => {
    const w = mount(EditorShell, {
      props: { state: "conflict" },
      slots: { conflict: "<p class='picker'>pick</p>", "conflict-actions": "<button>Reload and drop mine</button>" },
      global: uiGlobal,
    });
    expect(w.text()).toContain("Changed by someone else");
    expect(w.find(".picker").exists()).toBe(true);
    expect(w.text()).toContain("Reload and drop mine");
  });

  it("reports busy and locks the fields while saving", () => {
    const w = mount(EditorShell, {
      props: { state: "saving" },
      slots: { default: (slot: { locked: boolean }) => h("p", { class: "fields" }, String(slot.locked)) },
    });
    expect(w.attributes("aria-busy")).toBe("true");
    expect(w.find(".fields").text()).toBe("true");
  });

  it("puts banners, then the bar, then the body", () => {
    const w = mount(EditorShell, {
      props: { state: "clean" },
      slots: { banners: "<p id='b'>b</p>", bar: "<p id='bar'>bar</p>", default: "<p id='body'>body</p>" },
    });
    const ids = w.findAll("p").map((p) => p.attributes("id"));
    expect(ids).toEqual(["b", "bar", "body"]);
  });
});

describe("FieldRow help and effect", () => {
  it("describes the control by key, help, effect and error in that order", () => {
    const w = mount(FieldRow, {
      props: { id: "f", label: "Port", keyPath: "webui.port", help: "HTTP port.", effect: "Restart the dashboard.", error: "Use 65535 or less." },
      slots: { default: (slot: { id: string; describedBy?: string }) => h("input", { id: slot.id, "aria-describedby": slot.describedBy }) },
    });
    expect(w.find("input").attributes("aria-describedby")).toBe("f-key f-help f-effect f-error");
    expect(w.find("#f-effect").text()).toBe("Restart the dashboard.");
    expect(w.find("label").attributes("id")).toBe("f-label");
  });

  it("clamps long help behind a More toggle", async () => {
    const w = mount(FieldRow, { props: { label: "Trust proxy", help: "x".repeat(400) } });
    const toggle = w.find("button.fr-more");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(w.find(".fr-help").classes()).toContain("clamped");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(w.find(".fr-help").classes()).not.toContain("clamped");
  });

  it("marks a conflict on the edge", () => {
    expect(mount(FieldRow, { props: { label: "x", conflict: true } }).classes()).toContain("conflict");
  });
});

function contextWith(over: Partial<SchemaFormContext> = {}): SchemaFormContext {
  return {
    isVisible: () => true,
    filtering: () => false,
    showAll: () => false,
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

function mountField(props: Record<string, unknown>, context: SchemaFormContext) {
  const Host = defineComponent({
    setup() {
      provide(SchemaFormKey, context);
      return () => h(SchemaField, props);
    },
  });
  return mount(Host, { global: uiGlobal, attachTo: document.body });
}

describe("SchemaField in a schema form", () => {
  it("binds the label, shows the key and marks a change with the old value", async () => {
    const w = mountField(
      { name: "tpsWarningThreshold", schema: { type: "number", title: "TPS warning threshold" }, keyPath: ["tpsWarningThreshold"], modelValue: 17 },
      contextWith({ baselineAt: () => ({ known: true, value: 15 }) }),
    );
    expect(w.find("label").text()).toContain("TPS warning threshold");
    expect(w.find("label").attributes("for")).toBe("t-tpsWarningThreshold");
    expect(w.find("#t-tpsWarningThreshold").exists()).toBe(true);
    expect(w.find(".fr-key").text()).toBe("tpsWarningThreshold");
    expect(w.find(".field-row").classes()).toContain("dirty");
    expect(w.find(".sf-was").text()).toContain("15");
    await w.find(".sf-reset").trigger("click");
    expect(w.findComponent(SchemaField).emitted("update:model-value")![0]).toEqual([15]);
    w.unmount();
  });

  it("shows the field's error and marks it invalid", () => {
    const w = mountField(
      { name: "port", schema: { type: "number" }, keyPath: ["webui", "port"], modelValue: 70000 },
      contextWith({ errorFor: () => "Use 65535 or less." }),
    );
    expect(w.find(".fr-error").text()).toBe("Use 65535 or less.");
    expect(w.find(".field-row").classes()).toContain("invalid");
    w.unmount();
  });

  it("renders a stored secret as an empty password box that keeps it when left empty", async () => {
    const w = mountField(
      { name: "apiKey", schema: { type: "string" }, keyPath: ["servers", "smp", "apiKey"], modelValue: SECRET_PLACEHOLDER },
      contextWith({ isSecret: () => true, baselineAt: () => ({ known: true, value: SECRET_PLACEHOLDER }) }),
    );
    const input = w.find("input");
    expect(input.attributes("type")).toBe("password");
    expect(input.attributes("autocomplete")).toBe("new-password");
    expect((input.element as HTMLInputElement).value).toBe("");
    expect(input.attributes("placeholder")).toBe("Set. Type to replace.");
    expect(w.text()).toContain("never sent to the browser");
    await input.setValue("new-key");
    await input.setValue("");
    const emitted = w.findComponent(SchemaField).emitted("update:model-value")!;
    expect(emitted.at(0)).toEqual(["new-key"]);
    expect(emitted.at(-1)).toEqual([SECRET_PLACEHOLDER]);
    w.unmount();
  });

  it("hides a field the filter leaves out", () => {
    const w = mountField(
      { name: "language", schema: { type: "string" }, keyPath: ["language"], modelValue: "en" },
      contextWith({ isVisible: () => false }),
    );
    expect(w.find(".field-row").exists()).toBe(false);
    w.unmount();
  });

  it("opens a section around a problem", () => {
    const w = mountField(
      {
        name: "hostAlerts",
        schema: { type: "object", properties: { diskWarnPercent: { type: "number" } } },
        keyPath: ["hostAlerts"],
        modelValue: { diskWarnPercent: 120 },
      },
      contextWith({ hasProblemUnder: () => true }),
    );
    expect(w.find(".section-head").attributes("aria-expanded")).toBe("true");
    expect(w.find(".section-body").exists()).toBe(true);
    w.unmount();
  });

  it("disables its control while the editor is locked", () => {
    const w = mountField(
      { name: "language", schema: { type: "string" }, keyPath: ["language"], modelValue: "en" },
      contextWith({ locked: () => true }),
    );
    expect(w.find("input").attributes("disabled")).toBeDefined();
    w.unmount();
  });
});

describe("ReviewChanges", () => {
  it("lists was and now per field, hides secrets and saves", async () => {
    const w = mount(ReviewChanges, {
      props: {
        visible: true,
        canSave: true,
        changes: [
          { key: "tpsWarningThreshold", before: 15, after: 17 },
          { key: "servers.smp.apiKey", before: SECRET_PLACEHOLDER, after: "new", secret: true },
        ],
      },
      global: uiGlobal,
      attachTo: document.body,
    });
    await settle();
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.textContent).toContain("Review 2 changes");
    expect(dialog.querySelector("del")!.textContent).toBe("15");
    expect(dialog.querySelector("ins")!.textContent).toBe("17");
    expect(dialog.textContent).toContain("Secret changed");
    expect(dialog.textContent).not.toContain("new");
    const save = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.includes("Save 2 changes"))!;
    save.click();
    expect(w.emitted("save")).toHaveLength(1);
    w.unmount();
  });
});
