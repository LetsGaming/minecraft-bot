import { describe, it, expect } from "vitest";
import {
  alertMention,
  roleMention,
  safeMentions,
  shouldPing,
} from "../../src/bot/utils/embeds/alertUtils.js";

describe("safeMentions", () => {
  it("blocks every ping for relayed text", () => {
    expect(safeMentions("none")).toEqual({ parse: [] });
  });

  it("allows exactly one role and nothing else", () => {
    expect(safeMentions("role", "42")).toEqual({ parse: [], roles: ["42"] });
  });
});

describe("roleMention", () => {
  it("pings the role and allows only that role", () => {
    expect(roleMention("42")).toEqual({
      content: "<@&42>",
      allowedMentions: { parse: [], roles: ["42"] },
    });
  });

  it("still sets allowedMentions when no role is configured", () => {
    expect(roleMention(undefined)).toEqual({ allowedMentions: { parse: [] } });
  });
});

describe("shouldPing", () => {
  it("pings on the first failure and when severity rises", () => {
    expect(shouldPing("ok", "warning")).toBe(true);
    expect(shouldPing("ok", "critical")).toBe(true);
    expect(shouldPing("warning", "critical")).toBe(true);
  });

  it("never pings for repeats, improvements or recoveries", () => {
    expect(shouldPing("warning", "warning")).toBe(false);
    expect(shouldPing("critical", "warning")).toBe(false);
    expect(shouldPing("critical", "ok")).toBe(false);
    expect(shouldPing("ok", "ok")).toBe(false);
  });
});

describe("alertMention policy", () => {
  it("defaults to escalation: the first failure pings, the recovery does not", () => {
    expect(alertMention("42", undefined, "ok", "critical").content).toBe("<@&42>");
    expect(alertMention("42", undefined, "critical", "ok").content).toBeUndefined();
  });

  it("always pings every alert, including repeats and recoveries", () => {
    expect(alertMention("42", "always", "warning", "warning").content).toBe("<@&42>");
    expect(alertMention("42", "always", "critical", "ok").content).toBe("<@&42>");
  });

  it("escalation pings the first failure only", () => {
    expect(alertMention("42", "escalation", "ok", "critical").content).toBe("<@&42>");
    expect(alertMention("42", "escalation", "critical", "critical").content).toBeUndefined();
  });

  it("escalation posts recoveries silently, with mentions blocked", () => {
    const m = alertMention("42", "escalation", "critical", "ok");
    expect(m.content).toBeUndefined();
    expect(m.allowedMentions).toEqual({ parse: [] });
  });

  it("treats an unknown policy value like the default", () => {
    expect(alertMention("42", "bogus" as never, "critical", "ok").content).toBeUndefined();
    expect(alertMention("42", "bogus" as never, "ok", "critical").content).toBe("<@&42>");
  });
});
