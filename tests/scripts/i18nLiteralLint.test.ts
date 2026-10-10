import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
// @ts-expect-error plain ESM script without type declarations
import { lintRepo, lintSource } from "../../scripts/lib/i18nLiteralLint.mjs";

interface Finding {
  file: string;
  line: number;
  text: string;
}

const lint = (source: string, file = "src/bot/commands/x.ts"): Finding[] =>
  lintSource(file, source);

describe("i18n literal lint: flagged", () => {
  it.each([
    ["reply string", 'await interaction.reply("Hello there");'],
    ["editReply template", "await interaction.editReply(`Hi ${name}, welcome`);"],
    ["reply content", 'await interaction.reply({ content: "Nope", ephemeral: true });'],
    ["followUp content", 'await i.followUp({ content: "Done." });'],
    ["embed title", 'embed.setTitle("Server Status");'],
    ["embed description", "embed.setDescription(`Players: ${n}`);"],
    ["embed footer", 'embed.setFooter({ text: "Updates often" });'],
    ["embed author", 'embed.setAuthor({ name: "The Bot" });'],
    ["embed fields", 'embed.addFields({ name: "Ping", value: `${ms}ms` });'],
    ["button label", 'new ButtonBuilder().setLabel("Accept");'],
    ["createEmbed options", 'createEmbed({ title: "Info", footer: { text: "Foot note" } });'],
    ["error embed helper", 'createErrorEmbed("Something broke");'],
    ["concatenation", 'interaction.reply("Hello " + name + " friend");'],
    ["conditional branch", 'interaction.reply(ok ? t("a.b") : "Failed badly");'],
    ["thrown error in a command", 'throw new Error("You cannot do that");'],
    ["embed fields array", 'createEmbed({ fields: [{ name: "Label", value: x }] });'],
  ])("%s", (_name, code) => {
    expect(lint(code).length).toBeGreaterThan(0);
  });

  it("reports file, line and text", () => {
    const [finding] = lint('\n\nawait interaction.reply("Hello there");');
    expect(finding).toMatchObject({ file: "src/bot/commands/x.ts", line: 3 });
    expect(finding!.text).toBe("Hello there");
  });

  it("flags thrown errors in the guild router", () => {
    expect(
      lint('throw new Error("No such server");', "src/bot/utils/guild/guildRouter.ts"),
    ).toHaveLength(1);
  });
});

describe("i18n literal lint: accepted", () => {
  it.each([
    ["translated reply", 'await interaction.reply(t("common.noPermission"));'],
    ["translated with vars", 'embed.setTitle(t("a.b", { x: 1 }, guildId));'],
    ["emoji only", 'embed.setFooter({ text: "🏆" });'],
    ["digits and punctuation", "embed.setDescription(`${a} / ${b}`);"],
    ["unit suffix", "embed.addFields({ name: t(\"a.b\"), value: `${ms}ms` });"],
    ["url", 'embed.setDescription("https://example.com/path");'],
    ["custom id", 'new ButtonBuilder().setCustomId("poll:vote:1").setLabel(t("a.b"));'],
    ["console command", 'await server.send("/whitelist add Steve");'],
    ["console command template", "await server.send(`/ban ${player}`);"],
    ["variable argument", "await interaction.reply(message);"],
    ["slash command metadata", 'new SlashCommandBuilder().setName("x").setDescription("Does a thing");'],
    [
      "slash option metadata",
      'b.addStringOption((o) => o.setName("server").setDescription("Server instance"));',
    ],
    ["log call", 'log.info("tag", "Something happened");'],
    ["non-sink call", 'map.set("Some key", 1);'],
  ])("%s", (_name, code) => {
    expect(lint(code)).toEqual([]);
  });

  it("does not flag thrown errors outside the command layer", () => {
    expect(lint('throw new Error("Internal failure");', "src/bot/logWatcher/x.ts")).toEqual(
      [],
    );
  });
});

describe("i18n literal lint: repository", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const allowlist = JSON.parse(
    fs.readFileSync(path.join(root, "scripts", "i18n-literal-allowlist.json"), "utf-8"),
  ) as { path: string; reason: string; text?: string }[];

  it("finds no user-facing literals outside t()", () => {
    expect(lintRepo(root, allowlist)).toEqual([]);
  });

  it("gives every allowlist entry a reason", () => {
    for (const entry of allowlist) {
      expect(entry.reason.trim().length).toBeGreaterThan(10);
      expect(fs.existsSync(path.join(root, entry.path))).toBe(true);
    }
  });

  it("honours whole-file and text-scoped allowlist entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-lint-"));
    try {
      const rel = "src/bot/commands";
      fs.mkdirSync(path.join(dir, rel), { recursive: true });
      fs.writeFileSync(
        path.join(dir, rel, "a.ts"),
        'interaction.reply("Hello there");\ninteraction.reply("Other text");\n',
      );
      const file = `${rel}/a.ts`;
      expect(lintRepo(dir, [])).toHaveLength(2);
      expect(lintRepo(dir, [{ path: file, reason: "x" }])).toEqual([]);
      const scoped = lintRepo(dir, [{ path: file, text: "Hello", reason: "x" }]);
      expect(scoped.map((f: Finding) => f.text)).toEqual(["Other text"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
