// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { STATUS_TABLE, STATUS_ROLES, ServerState, ConfigApplyState } from "../../../src/schema/index";
import StatusChip from "../../../src/web/frontend/src/components/ui/StatusChip.vue";
import StatusDot from "../../../src/web/frontend/src/components/ui/StatusDot.vue";

describe("StatusChip", () => {
  it("draws every role with its own shape and the glossary label", () => {
    for (const role of STATUS_ROLES) {
      const w = mount(StatusChip, { props: { state: role } });
      expect(w.find(`.shape-${STATUS_TABLE[role].shape}`).exists()).toBe(true);
      expect(w.find(".shape").attributes("aria-hidden")).toBe("true");
      expect(w.text()).not.toBe("");
    }
  });

  it("maps server and apply states onto roles", () => {
    expect(mount(StatusChip, { props: { state: ServerState.Unresponsive } }).classes()).toContain("st-degraded");
    expect(mount(StatusChip, { props: { state: ConfigApplyState.BotDown } }).classes()).toContain("st-offline");
  });

  it("keeps the label for assistive tech when only the shape is shown", () => {
    const w = mount(StatusChip, { props: { state: "online", variant: "dot", label: "smp online" } });
    expect(w.find(".sr-only").text()).toBe("smp online");
    expect(w.attributes("title")).toBe("smp online");
  });

  it("is a live region only when asked", () => {
    expect(mount(StatusChip, { props: { state: "pending" } }).attributes("role")).toBeUndefined();
    expect(mount(StatusChip, { props: { state: "pending", live: true } }).attributes("role")).toBe("status");
  });
});

describe("StatusDot", () => {
  it("keeps its up/down/stale props and renders shapes, not bare colour", () => {
    expect(mount(StatusDot, { props: { state: "up" } }).find(".shape-filled-circle").exists()).toBe(true);
    expect(mount(StatusDot, { props: { state: "down" } }).find(".shape-ring").exists()).toBe(true);
    expect(mount(StatusDot, { props: { state: "stale" } }).find(".shape-diamond").exists()).toBe(true);
    expect(mount(StatusDot, { props: { state: "down" } }).find(".sr-only").text()).toBe("Offline");
  });
});
