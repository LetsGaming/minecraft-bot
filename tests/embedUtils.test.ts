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
} from "../src/utils/embedUtils.js";

// ── createEmbed ──────────────────────────────────────────────────────────────

describe("createEmbed", () => {
  it("returns an EmbedBuilder instance", () => {
    expect(createEmbed({})).toBeInstanceOf(EmbedBuilder);
  });

  it("sets title when provided", () => {
    const embed = createEmbed({ title: "Hello" });
    expect(embed.toJSON().title).toBe("Hello");
  });

  it("sets description when provided", () => {
    const embed = createEmbed({ description: "World" });
    expect(embed.toJSON().description).toBe("World");
  });

  it("uses default color 0x00bfff", () => {
    expect(createEmbed({}).toJSON().color).toBe(0x00bfff);
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
    expect(createEmbed({ description: "only desc" }).toJSON().title).toBeUndefined();
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
  it("sets title to ❌ Error", () => {
    expect(createErrorEmbed("broken").toJSON().title).toBe("❌ Error");
  });

  it("sets description to the provided message", () => {
    expect(createErrorEmbed("oops").toJSON().description).toBe("oops");
  });

  it("uses red color 0xff5555", () => {
    expect(createErrorEmbed("x").toJSON().color).toBe(0xff5555);
  });

  it("accepts optional footer", () => {
    const embed = createErrorEmbed("err", { footer: { text: "hint" } });
    expect(embed.toJSON().footer?.text).toBe("hint");
  });

  it("includes timestamp by default", () => {
    expect(createErrorEmbed("err").toJSON().timestamp).toBeTruthy();
  });

  it("omits timestamp when timestamp=false", () => {
    expect(createErrorEmbed("err", { timestamp: false }).toJSON().timestamp).toBeUndefined();
  });
});

// ── createSuccessEmbed ───────────────────────────────────────────────────────

describe("createSuccessEmbed", () => {
  it("sets title to ✅ Success", () => {
    expect(createSuccessEmbed("done").toJSON().title).toBe("✅ Success");
  });

  it("uses green color 0x55ff55", () => {
    expect(createSuccessEmbed("done").toJSON().color).toBe(0x55ff55);
  });

  it("sets description", () => {
    expect(createSuccessEmbed("it worked").toJSON().description).toBe("it worked");
  });
});

// ── createInfoEmbed ──────────────────────────────────────────────────────────

describe("createInfoEmbed", () => {
  it("sets title to ℹ️ Info", () => {
    expect(createInfoEmbed("info").toJSON().title).toBe("ℹ️ Info");
  });

  it("uses blue color 0x3498db", () => {
    expect(createInfoEmbed("msg").toJSON().color).toBe(0x3498db);
  });

  it("sets description", () => {
    expect(createInfoEmbed("tip here").toJSON().description).toBe("tip here");
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
    const embed = createPlayerEmbed("Hero", { description: "desc", color: 0x123456 });
    const json = embed.toJSON();
    expect(json.description).toBe("desc");
    expect(json.color).toBe(0x123456);
  });
});

// ── createPaginationButtons ──────────────────────────────────────────────────

describe("createPaginationButtons", () => {
  it("disables first and prev on page 0", () => {
    const row = createPaginationButtons(0, 5);
    const components = row.toJSON().components;
    const first = components.find((c) => c.custom_id === "first");
    const prev = components.find((c) => c.custom_id === "prev");
    expect(first?.disabled).toBe(true);
    expect(prev?.disabled).toBe(true);
  });

  it("disables next and last on the last page", () => {
    const row = createPaginationButtons(4, 5);
    const components = row.toJSON().components;
    const next = components.find((c) => c.custom_id === "next");
    const last = components.find((c) => c.custom_id === "last");
    expect(next?.disabled).toBe(true);
    expect(last?.disabled).toBe(true);
  });

  it("enables all buttons on a middle page", () => {
    const row = createPaginationButtons(2, 5);
    expect(row.toJSON().components.every((c) => !c.disabled)).toBe(true);
  });

  it("creates exactly 4 button components", () => {
    const row = createPaginationButtons(1, 3);
    expect(row.toJSON().components).toHaveLength(4);
  });

  it("disables all navigation when there is only one page", () => {
    const row = createPaginationButtons(0, 1);
    const components = row.toJSON().components;
    expect(components.every((c) => c.disabled)).toBe(true);
  });
});
