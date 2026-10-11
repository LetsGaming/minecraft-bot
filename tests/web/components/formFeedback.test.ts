// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import FieldRow from "../../../src/web/frontend/src/components/ui/FieldRow.vue";
import FieldHint from "../../../src/web/frontend/src/components/ui/FieldHint.vue";
import InlineError from "../../../src/web/frontend/src/components/ui/InlineError.vue";
import InlineBanner from "../../../src/web/frontend/src/components/ui/InlineBanner.vue";
import EmptyState from "../../../src/web/frontend/src/components/ui/EmptyState.vue";
import ViewHeader from "../../../src/web/frontend/src/components/ui/ViewHeader.vue";
import { uiGlobal } from "./mountUi";
import { t } from "../../../src/web/frontend/src/i18n";

describe("FieldRow", () => {
  function row(props: Record<string, unknown>) {
    return mount(FieldRow, {
      props: { label: "API URL", ...props },
      slots: {
        default: (slot: { id: string; describedBy?: string; invalid: boolean }) =>
          h("input", { id: slot.id, "aria-describedby": slot.describedBy, "aria-invalid": slot.invalid }),
      },
      global: uiGlobal,
    });
  }

  it("binds the label to the input in the slot", () => {
    const w = row({});
    const input = w.find("input");
    expect(input.attributes("id")).toBeTruthy();
    expect(w.find("label").attributes("for")).toBe(input.attributes("id"));
  });

  it("uses a given id", () => {
    const w = row({ id: "cfg-apiUrl" });
    expect(w.find("label").attributes("for")).toBe("cfg-apiUrl");
    expect(w.find("input").attributes("id")).toBe("cfg-apiUrl");
  });

  it("describes the input by its key line and its error", () => {
    const w = row({ id: "f", keyPath: "servers.smp.apiUrl", error: "Not a URL" });
    expect(w.find("input").attributes("aria-describedby")).toBe("f-key f-error");
    expect(w.find("#f-error").attributes("role")).toBe("alert");
    expect(w.find("#f-key").text()).toBe("servers.smp.apiUrl");
    expect(w.find("input").attributes("aria-invalid")).toBe("true");
  });

  it("marks a changed field", () => {
    expect(row({ dirty: true }).classes()).toContain("dirty");
  });
});

describe("FieldHint", () => {
  it("names the button after its field and links the text as its description", async () => {
    const w = mount(FieldHint, { props: { text: "Where the wrapper listens.", label: "API URL" } });
    const button = w.find("button");
    expect(button.attributes("aria-label")).toBe("Help for API URL");
    const popId = button.attributes("aria-describedby");
    expect(w.find(`#${popId}`).text()).toBe("Where the wrapper listens.");
    expect(button.attributes("aria-expanded")).toBe("false");
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    await button.trigger("keydown", { key: "Escape" });
    expect(button.attributes("aria-expanded")).toBe("false");
  });
});

describe("InlineError", () => {
  it("is an alert with problem, recovery, detail and a retry that emits", async () => {
    const w = mount(InlineError, {
      props: { title: "The list did not load", recovery: "Try again.", detail: "GET /x -> 502" },
      global: uiGlobal,
    });
    expect(w.attributes("role")).toBe("alert");
    expect(w.find("h3").text()).toBe("The list did not load");
    expect(w.find("code").text()).toBe("GET /x -> 502");
    const retry = w.find("button");
    expect(retry.classes()).toContain("tap");
    await retry.trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it("takes its default labels from the copy table", () => {
    const w = mount(InlineError, { props: { title: "x" }, global: uiGlobal });
    expect(w.find("button").text()).toBe(t("ui.retry"));
    expect(w.text()).toContain(t("ui.error"));
  });
});

describe("InlineBanner", () => {
  it("announces politely, and assertively only for danger", () => {
    expect(mount(InlineBanner, { props: { tone: "warn" } }).attributes("role")).toBe("status");
    expect(mount(InlineBanner, { props: { tone: "danger" } }).attributes("role")).toBe("alert");
  });
});

describe("EmptyState", () => {
  it("adds a heading when titled and keeps the old slot-only form", () => {
    const titled = mount(EmptyState, { props: { title: "No backups yet" }, slots: { default: "Make one." } });
    expect(titled.find("h3").text()).toBe("No backups yet");
    const plain = mount(EmptyState, { slots: { default: "Nothing." } });
    expect(plain.find("h3").exists()).toBe(false);
    expect(plain.find("i").attributes("aria-hidden")).toBe("true");
  });
});

describe("ViewHeader", () => {
  it("is the page's h1, with a server chip that names the state", () => {
    const w = mount(ViewHeader, { props: { title: "Backups", server: "smp", serverState: "online" } });
    expect(w.find("h1").text()).toBe("Backups");
    expect(w.find(".status-chip").text()).toBe("smp, online");
  });
});
