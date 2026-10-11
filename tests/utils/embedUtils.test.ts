import { describe, it, expect } from "vitest";
import { EmbedBuilder } from "discord.js";
import {
  createEmbed,
  addFieldsBulk,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  createEmbedWithThumbnail,
  createPlayerEmbed,
  createPaginationButtons,
  createProgressEmbed,
  paginateFields,
  paginateLines,
  chunkLines,
  truncate,
  EMBED_LIMITS,
} from "../../src/bot/utils/embeds/embedUtils.js";
import { ServerState } from "../../src/schema/serverState.js";
import { STATUS_TABLE } from "../../src/schema/status.js";

const INFO = STATUS_TABLE.info.embedColour;
const RED = STATUS_TABLE.offline.embedColour;
const GREEN = STATUS_TABLE.applied.embedColour;

// ── createEmbed ──────────────────────────────────────────────────────────────

describe("createEmbed", () => {
  it("returns an EmbedBuilder instance", () => {
    expect(createEmbed({})).toBeInstanceOf(EmbedBuilder);
  });

  it("has no timestamp by default", () => {
    expect(createEmbed({ title: "x" }).toJSON().timestamp).toBeUndefined();
  });

  it("prefixes the state circle and takes the state colour", () => {
    const json = createEmbed({ title: "smp: Online", state: ServerState.Online }).toJSON();
    expect(json.title).toBe("🟢 smp: Online");
    expect(json.color).toBe(STATUS_TABLE.online.embedColour);
  });

  it("cuts a title to the 256 character limit", () => {
    const title = createEmbed({ title: "x".repeat(400) }).toJSON().title!;
    expect(title).toHaveLength(EMBED_LIMITS.title);
    expect(title.endsWith("…")).toBe(true);
  });

  it("cuts a description to the 4096 character limit", () => {
    const description = createEmbed({ description: "y".repeat(5000) }).toJSON().description!;
    expect(description).toHaveLength(EMBED_LIMITS.description);
  });

  it("sets title when provided", () => {
    const embed = createEmbed({ title: "Hello" });
    expect(embed.toJSON().title).toBe("Hello");
  });

  it("sets description when provided", () => {
    const embed = createEmbed({ description: "World" });
    expect(embed.toJSON().description).toBe("World");
  });

  it("uses the info status colour by default", () => {
    expect(createEmbed({}).toJSON().color).toBe(INFO);
  });

  it("applies a custom color", () => {
    expect(createEmbed({ color: 0xff0000 }).toJSON().color).toBe(0xff0000);
  });

  it("sets footer text when provided", () => {
    const embed = createEmbed({ footer: { text: "My footer" } });
    expect(embed.toJSON().footer?.text).toBe("My footer");
  });

  it("omits footer when not provided", () => {
    expect(createEmbed({}).toJSON().footer).toBeUndefined();
  });

  it("sets author when provided", () => {
    const embed = createEmbed({ author: { name: "SomeBot" } });
    expect(embed.toJSON().author?.name).toBe("SomeBot");
  });

  it("sets a timestamp when timestamp=true", () => {
    const embed = createEmbed({ timestamp: true });
    expect(embed.toJSON().timestamp).toBeTruthy();
  });

  it("omits timestamp when timestamp=false", () => {
    const embed = createEmbed({ timestamp: false });
    expect(embed.toJSON().timestamp).toBeUndefined();
  });

  it("sets timestamp from a Date object", () => {
    const date = new Date("2025-03-01T12:00:00.000Z");
    const embed = createEmbed({ timestamp: date });
    expect(embed.toJSON().timestamp).toBe(date.toISOString());
  });

  it("sets timestamp from a number (epoch ms)", () => {
    const epoch = new Date("2025-01-01T00:00:00.000Z").getTime();
    const embed = createEmbed({ timestamp: epoch });
    expect(embed.toJSON().timestamp).toBeTruthy();
  });

  it("sets timestamp from a string", () => {
    const embed = createEmbed({ timestamp: "2025-05-01T00:00:00.000Z" });
    expect(embed.toJSON().timestamp).toBeTruthy();
  });

  it("omits title when not provided", () => {
    expect(
      createEmbed({ description: "only desc" }).toJSON().title,
    ).toBeUndefined();
  });
});

// ── addFieldsBulk ────────────────────────────────────────────────────────────

describe("addFieldsBulk", () => {
  it("adds provided fields to the embed", () => {
    const embed = new EmbedBuilder();
    addFieldsBulk(embed, [
      { name: "Field A", value: "Value A" },
      { name: "Field B", value: "Value B", inline: true },
    ]);
    const fields = embed.toJSON().fields ?? [];
    expect(fields).toHaveLength(2);
    expect(fields[0]?.name).toBe("Field A");
    expect(fields[1]?.inline).toBe(true);
  });

  it("returns the embed unchanged when fields array is empty", () => {
    const embed = new EmbedBuilder();
    const result = addFieldsBulk(embed, []);
    expect(result).toBe(embed);
    expect(result.toJSON().fields ?? []).toHaveLength(0);
  });

  it("returns the embed unchanged when fields is omitted", () => {
    const embed = new EmbedBuilder();
    const result = addFieldsBulk(embed);
    expect(result).toBe(embed);
  });
});

// ── createErrorEmbed ─────────────────────────────────────────────────────────

describe("createErrorEmbed", () => {
  it("falls back to a generic title without an emoji", () => {
    expect(createErrorEmbed("broken").toJSON().title).toBe("Command failed");
  });

  it("renders problem then recovery and uses the given title", () => {
    const json = createErrorEmbed({
      title: "Could not reach smp",
      problem: "smp did not answer.",
      recovery: "Try again in a minute.",
    }).toJSON();
    expect(json.title).toBe("Could not reach smp");
    expect(json.description).toBe("smp did not answer.\nTry again in a minute.");
  });

  it("sets description to a plain message", () => {
    expect(createErrorEmbed("oops").toJSON().description).toBe("oops");
  });

  it("uses the offline status red", () => {
    expect(createErrorEmbed("x").toJSON().color).toBe(RED);
  });

  it("has no timestamp and no footer by default", () => {
    const json = createErrorEmbed("err").toJSON();
    expect(json.timestamp).toBeUndefined();
    expect(json.footer).toBeUndefined();
  });
});

// ── createSuccessEmbed / createInfoEmbed ─────────────────────────────────────

describe("createSuccessEmbed", () => {
  it("has no default title", () => {
    expect(createSuccessEmbed("done").toJSON().title).toBeUndefined();
  });

  it("takes a title naming the action", () => {
    expect(createSuccessEmbed("done", { title: "Player banned" }).toJSON().title).toBe(
      "Player banned",
    );
  });

  it("uses the applied status green", () => {
    expect(createSuccessEmbed("done").toJSON().color).toBe(GREEN);
  });

  it("sets description", () => {
    expect(createSuccessEmbed("it worked").toJSON().description).toBe("it worked");
  });
});

describe("createInfoEmbed", () => {
  it("has no default title", () => {
    expect(createInfoEmbed("info").toJSON().title).toBeUndefined();
  });

  it("shares the info colour with createEmbed's default", () => {
    expect(createInfoEmbed("msg").toJSON().color).toBe(createEmbed({}).toJSON().color);
  });
});

// ── createProgressEmbed ──────────────────────────────────────────────────────

describe("createProgressEmbed", () => {
  it("adds the start as a relative Discord timestamp", () => {
    const json = createProgressEmbed({
      title: "Stopping smp",
      description: "Saving the world.",
      startedAt: 1_700_000_000_000,
    }).toJSON();
    expect(json.color).toBe(INFO);
    expect(json.description).toContain("Saving the world.");
    expect(json.description).toContain("<t:1700000000:R>");
  });
});

// ── limit-aware paging ───────────────────────────────────────────────────────

describe("truncate", () => {
  it("leaves short text alone and marks a cut", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});

describe("chunkLines", () => {
  it("packs lines into values under the field limit", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `[Mod ${i}](https://modrinth.com/mod/mod-${i})`);
    const chunks = chunkLines(lines);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    expect(chunks.join("\n").split("\n")).toHaveLength(200);
  });

  it("cuts a single line that is longer than the limit", () => {
    const [chunk] = chunkLines(["z".repeat(2000)]);
    expect(chunk).toHaveLength(EMBED_LIMITS.fieldValue);
  });
});

describe("paginateLines", () => {
  it("respects the line count per page", () => {
    const pages = paginateLines(Array.from({ length: 25 }, (_, i) => `line ${i}`), 10);
    expect(pages).toHaveLength(3);
    expect(pages[2]!.split("\n")).toHaveLength(5);
  });

  it("returns one empty page for no lines", () => {
    expect(paginateLines([], 10)).toEqual([""]);
  });
});

describe("paginateFields", () => {
  const field = (i: number, size = 1000) => ({ name: `Field ${i}`, value: "v".repeat(size) });

  it("keeps every page under 6000 characters including the reserved part", () => {
    const fields = Array.from({ length: 30 }, (_, i) => field(i));
    const pages = paginateFields(fields, { reserved: 300 });
    for (const page of pages) {
      const total = page.reduce((n, f) => n + f.name.length + f.value.length, 0);
      expect(total + 300).toBeLessThanOrEqual(EMBED_LIMITS.total);
    }
    expect(pages.flat()).toHaveLength(30);
  });

  it("never puts more than 25 fields on a page", () => {
    const pages = paginateFields(Array.from({ length: 60 }, (_, i) => field(i, 10)));
    expect(pages.map((p) => p.length)).toEqual([25, 25, 10]);
  });

  it("honours a smaller maxFields", () => {
    const pages = paginateFields(Array.from({ length: 7 }, (_, i) => field(i, 10)), { maxFields: 3 });
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
  });

  it("cuts oversized names and values", () => {
    const [[only]] = paginateFields([{ name: "n".repeat(300), value: "v".repeat(2000) }]);
    expect(only!.name).toHaveLength(EMBED_LIMITS.fieldName);
    expect(only!.value).toHaveLength(EMBED_LIMITS.fieldValue);
  });

  it("returns one empty page for no fields", () => {
    expect(paginateFields([])).toEqual([[]]);
  });
});

// ── createEmbedWithThumbnail ─────────────────────────────────────────────────

describe("createEmbedWithThumbnail", () => {
  it("sets the thumbnail URL", () => {
    const embed = createEmbedWithThumbnail({
      title: "Test",
      thumbnail: "https://example.com/img.png",
    });
    expect(embed.toJSON().thumbnail?.url).toBe("https://example.com/img.png");
  });

  it("omits thumbnail when not provided", () => {
    const embed = createEmbedWithThumbnail({ title: "No thumb" });
    expect(embed.toJSON().thumbnail).toBeUndefined();
  });

  it("forwards title and description", () => {
    const embed = createEmbedWithThumbnail({
      title: "T",
      description: "D",
      thumbnail: "https://x.com/img.png",
    });
    const json = embed.toJSON();
    expect(json.title).toBe("T");
    expect(json.description).toBe("D");
  });
});

// ── createPlayerEmbed ────────────────────────────────────────────────────────

describe("createPlayerEmbed", () => {
  it("uses author icon by default (not thumbnail)", () => {
    const embed = createPlayerEmbed("Steve", { description: "Hi" });
    const json = embed.toJSON();
    expect(json.author?.name).toBe("Steve");
    expect(json.author?.icon_url).toContain("Steve");
    expect(json.thumbnail).toBeUndefined();
  });

  it("uses thumbnail mode when asThumbnail=true", () => {
    const embed = createPlayerEmbed("Alex", { description: "Hi" }, true);
    const json = embed.toJSON();
    expect(json.thumbnail?.url).toContain("Alex");
    expect(json.author).toBeUndefined();
  });

  it("includes mc-heads.net URL for player avatar", () => {
    const embed = createPlayerEmbed("Notch", {});
    expect(embed.toJSON().author?.icon_url).toContain("mc-heads.net");
  });

  it("passes through color and description", () => {
    const embed = createPlayerEmbed("Hero", {
      description: "desc",
      color: 0x123456,
    });
    const json = embed.toJSON();
    expect(json.description).toBe("desc");
    expect(json.color).toBe(0x123456);
  });
});

// ── createPaginationButtons ──────────────────────────────────────────────────

describe("createPaginationButtons", () => {
  it("is Previous, a disabled page indicator, Next", () => {
    const components = createPaginationButtons(1, 6).toJSON().components;
    expect(components.map((c) => ("custom_id" in c ? c.custom_id : ""))).toEqual([
      "prev",
      "page",
      "next",
    ]);
    const page = components[1]!;
    expect("label" in page ? page.label : "").toBe("Page 2/6");
    expect(page.disabled).toBe(true);
  });

  it("disables Previous on the first page and Next on the last", () => {
    const first = createPaginationButtons(0, 3).toJSON().components;
    const last = createPaginationButtons(2, 3).toJSON().components;
    expect(first[0]!.disabled).toBe(true);
    expect(first[2]!.disabled).toBe(false);
    expect(last[0]!.disabled).toBe(false);
    expect(last[2]!.disabled).toBe(true);
  });

  it("switches the whole row off when disabled", () => {
    const components = createPaginationButtons(1, 3, { disabled: true }).toJSON().components;
    expect(components.every((c) => c.disabled)).toBe(true);
  });
});

// ── EmbedColor palette ───────────────────────────────────────────────────────

describe("EmbedColor palette", () => {
  it("takes every semantic colour from the status table", async () => {
    const { EmbedColor } = await import("../../src/bot/utils/embeds/embedColors.js");
    expect(EmbedColor.Online).toBe(STATUS_TABLE.online.embedColour);
    expect(EmbedColor.Success).toBe(STATUS_TABLE.applied.embedColour);
    expect(EmbedColor.Warning).toBe(STATUS_TABLE.degraded.embedColour);
    expect(EmbedColor.Error).toBe(STATUS_TABLE.offline.embedColour);
    expect(EmbedColor.Neutral).toBe(STATUS_TABLE.unknown.embedColour);
    expect(EmbedColor.Pending).toBe(STATUS_TABLE.pending.embedColour);
    expect(EmbedColor.Info).toBe(STATUS_TABLE.info.embedColour);
  });
});
