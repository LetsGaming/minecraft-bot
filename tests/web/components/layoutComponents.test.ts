// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import ResponsiveTable from "../../../src/web/frontend/src/components/ui/ResponsiveTable.vue";
import JobBlock from "../../../src/web/frontend/src/components/ui/JobBlock.vue";
import EditBar from "../../../src/web/frontend/src/components/ui/EditBar.vue";
import EditorShell from "../../../src/web/frontend/src/components/ui/EditorShell.vue";
import ModIcon from "../../../src/web/frontend/src/components/ui/ModIcon.vue";
import { uiGlobal } from "./mountUi";

interface Row {
  id: string;
  name: string;
  size: string;
}

const rows: Row[] = [
  { id: "a", name: "smp-daily-1.tar.zst", size: "3 GB" },
  { id: "b", name: "smp-daily-2.tar.zst", size: "4 GB" },
];

describe("ResponsiveTable", () => {
  function table(busy?: (r: Row) => boolean) {
    return mount(ResponsiveTable, {
      props: {
        columns: [
          { key: "name", label: "Backup", primary: true },
          { key: "size", label: "Size", numeric: true, align: "end" },
        ],
        rows,
        caption: "Backups of smp",
        rowKey: (r: Row) => r.id,
        busy,
        actionsLabelVisible: false,
      },
      slots: {
        actions: ({ row }: { row: Row }) => h("button", { "aria-label": `Delete ${row.name}` }, "x"),
      },
    });
  }

  it("is a named table with column headers and a row header per row", () => {
    const w = table();
    expect(w.find("caption").text()).toBe("Backups of smp");
    expect(w.findAll("thead th").every((th) => th.attributes("scope") === "col")).toBe(true);
    const rowHeaders = w.findAll('tbody th[scope="row"]');
    expect(rowHeaders.map((th) => th.text())).toEqual(rows.map((r) => r.name));
  });

  it("labels each cell for the card layout and names the actions column for screen readers", () => {
    const w = table();
    expect(w.find("tbody td").attributes("data-label")).toBe("Size");
    expect(w.find("thead th:last-child .sr-only").text()).toBe("Actions");
    expect(w.find('button[aria-label="Delete smp-daily-1.tar.zst"]').exists()).toBe(true);
  });

  it("marks only the busy row", () => {
    const w = table((r) => r.id === "b");
    const trs = w.findAll("tbody tr");
    expect(trs[0]!.attributes("aria-busy")).toBeUndefined();
    expect(trs[1]!.attributes("aria-busy")).toBe("true");
    expect(trs[1]!.classes()).toContain("busy");
  });
});

describe("JobBlock", () => {
  it("shows an indeterminate progressbar while running", () => {
    const w = mount(JobBlock, { props: { title: "Creating a backup of smp", state: "running", startedAt: Date.now() - 72_000 } });
    const bar = w.find('[role="progressbar"]');
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("aria-valuenow")).toBeUndefined();
    expect(bar.attributes("aria-labelledby")).toBe(w.find("h2").attributes("id"));
    expect(w.find('[role="status"]').text()).toMatch(/^Running, 1m 1[12]s$/);
    w.unmount();
  });

  it("ends with the exit code and the output, without a bar", () => {
    const w = mount(JobBlock, {
      props: { title: "Restore failed", state: "failed", exitCode: 1, output: "[ERROR] Extraction failed" },
    });
    expect(w.find('[role="progressbar"]').exists()).toBe(false);
    expect(w.find('[role="status"]').text()).toBe("Exit code 1");
    const pre = w.find("pre");
    expect(pre.text()).toBe("[ERROR] Extraction failed");
    expect(pre.attributes("tabindex")).toBe("0");
    expect(pre.attributes("aria-label")).toBe("Script output");
  });
});

describe("EditBar", () => {
  it("offers nothing to save when clean", () => {
    const w = mount(EditBar, { props: { dirtyCount: 0 }, global: uiGlobal });
    expect(w.text()).toContain("No unsaved changes");
    expect(w.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  });

  it("counts changes and emits save and discard", async () => {
    const w = mount(EditBar, { props: { dirtyCount: 3 }, global: uiGlobal });
    expect(w.text()).toContain("3 unsaved changes");
    expect(w.attributes("role")).toBe("region");
    const [discard, save] = w.findAll("button");
    expect(save!.classes()).toContain("tap");
    await discard!.trigger("click");
    await save!.trigger("click");
    expect(w.emitted("discard")).toHaveLength(1);
    expect(w.emitted("save")).toHaveLength(1);
  });

  it("blocks saving while saving or with errors", () => {
    const saving = mount(EditBar, { props: { dirtyCount: 1, saving: true }, global: uiGlobal });
    expect(saving.text()).toContain("Saving");
    const invalid = mount(EditBar, { props: { dirtyCount: 1, canSave: false }, global: uiGlobal });
    expect(invalid.findAll("button").at(-1)!.attributes("disabled")).toBeDefined();
  });
});

describe("EditorShell", () => {
  it("says why it is read-only and labels the group list", () => {
    const w = mount(EditorShell, {
      props: { state: "readonly", readonlyReason: "Only sysadmins can change config.json." },
      slots: { nav: "<a href='#g'>General</a>", default: "<p>fields</p>" },
    });
    expect(w.text()).toContain("Only sysadmins can change config.json.");
    expect(w.find("nav").attributes("aria-label")).toBe("Groups");
  });

  it("reports busy while saving", () => {
    const w = mount(EditorShell, { props: { state: "saving" } });
    expect(w.attributes("aria-busy")).toBe("true");
  });
});

describe("ModIcon", () => {
  it("renders a sized, lazy image named after the mod", () => {
    const w = mount(ModIcon, { props: { name: "Fabric API", slug: "fabric-api", src: "/icon.png", size: 40 } });
    const img = w.find("img");
    expect(img.attributes()).toMatchObject({ width: "40", height: "40", loading: "lazy", alt: "Fabric API" });
  });

  it("falls back to an initials tile with a stable tint when the image fails", async () => {
    const w = mount(ModIcon, { props: { name: "Fabric API", slug: "fabric-api", src: "/broken.png" } });
    await w.find("img").trigger("error");
    const tile = w.find(".mod-tile");
    expect(tile.text()).toBe("FA");
    expect(tile.attributes("role")).toBe("img");
    expect(tile.attributes("aria-label")).toBe("Fabric API");
    const again = mount(ModIcon, { props: { name: "Other name", slug: "fabric-api" } });
    expect(again.find(".mod-tile").attributes("style")).toContain(
      tile.attributes("style")!.match(/var\(--tile-\d\)/)![0],
    );
  });

  it("hides itself from assistive tech when decorative", () => {
    const w = mount(ModIcon, { props: { name: "Sodium", decorative: true } });
    expect(w.find(".mod-tile").attributes("aria-hidden")).toBe("true");
  });
});
