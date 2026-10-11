import { describe, it, expect } from "vitest";
import {
  attachErrors,
  diffDocs,
  fieldDomId,
  fieldProblem,
  fieldText,
  filterFields,
  valueAt,
  walkFields,
} from "../../src/web/frontend/src/components/schema/formIndex";
import { humanizeKey } from "../../src/web/frontend/src/components/schema/schemaField";
import { configGroups } from "../../src/web/frontend/src/components/schema/configGroups";
import { parseFieldError } from "../../src/web/frontend/src/utils/fieldErrors";
import { isSecretConfigPath } from "../../src/schema/config";

const defs = {
  Server: {
    type: "object",
    properties: {
      apiUrl: { type: "string", title: "API URL", description: "Where the wrapper listens." },
      apiKey: { type: "string" },
    },
  },
  WebUi: {
    type: "object",
    properties: {
      port: { type: "integer", minimum: 1, maximum: 65535, effect: "Restart the dashboard." },
    },
  },
};

const props = {
  tpsWarningThreshold: { type: "number", exclusiveMinimum: 0, title: "TPS warning threshold" },
  servers: { type: "object", additionalProperties: { $ref: "#/definitions/Server" } },
  webui: { $ref: "#/definitions/WebUi", title: "Web dashboard" },
  chatBridge: { type: "array", items: { type: "object", properties: { channelId: { type: "string" } } } },
};

const doc = {
  tpsWarningThreshold: 15,
  servers: { smp: { apiUrl: "http://10.0.0.12:3100", apiKey: "•••••" } },
  webui: { port: 8130 },
  chatBridge: [{ channelId: "1" }],
};

describe("walkFields", () => {
  const entries = walkFields(props, doc, defs);
  const byKey = new Map(entries.map((e) => [e.path.join("."), e]));

  it("indexes every field with its real path, map entries and list items included", () => {
    expect([...byKey.keys()]).toEqual([
      "tpsWarningThreshold",
      "servers",
      "servers.smp",
      "servers.smp.apiUrl",
      "servers.smp.apiKey",
      "webui",
      "webui.port",
      "chatBridge",
      "chatBridge.0",
      "chatBridge.0.channelId",
    ]);
  });

  it("marks leaves and reads titles, falling back to the humanised key", () => {
    expect(byKey.get("servers")!.leaf).toBe(false);
    expect(byKey.get("servers.smp.apiUrl")!.leaf).toBe(true);
    expect(byKey.get("servers.smp.apiUrl")!.label).toBe("API URL");
    expect(byKey.get("servers.smp.apiKey")!.label).toBe("API key");
    expect(byKey.get("webui")!.label).toBe("Web dashboard");
  });

  it("names map entries through the editor's labeller", () => {
    const named = walkFields(props, doc, defs, [], { entryLabel: (map, key) => (map === "servers" ? `Server ${key}` : undefined) });
    expect(named.find((e) => e.path.join(".") === "servers.smp")!.label).toBe("Server smp");
  });
});

describe("fieldText", () => {
  it("reads title and help beside a $ref before following it", () => {
    expect(fieldText({ $ref: "#/definitions/WebUi", title: "Web dashboard", description: "Settings" }, defs)).toEqual({
      title: "Web dashboard",
      description: "Settings",
      effect: "",
    });
    expect(fieldText(defs.WebUi.properties.port, defs).effect).toBe("Restart the dashboard.");
  });
});

describe("filterFields", () => {
  const entries = walkFields(props, doc, defs);

  it("shows everything without a query", () => {
    const f = filterFields(entries, "  ");
    expect(f.active).toBe(false);
    expect(f.count).toBe(5);
  });

  it("matches label, key or help and keeps the ancestors", () => {
    const f = filterFields(entries, "wrapper");
    expect(f.count).toBe(1);
    expect(f.isVisible(["servers"])).toBe(true);
    expect(f.isVisible(["servers", "smp"])).toBe(true);
    expect(f.isVisible(["servers", "smp", "apiUrl"])).toBe(true);
    expect(f.isVisible(["servers", "smp", "apiKey"])).toBe(false);
    expect(f.isVisible(["webui"])).toBe(false);
  });

  it("shows a matching section whole", () => {
    const f = filterFields(entries, "web dashboard");
    expect(f.isVisible(["webui", "port"])).toBe(true);
    expect(f.count).toBe(1);
  });

  it("needs every word of the query", () => {
    expect(filterFields(entries, "tps threshold").count).toBe(1);
    expect(filterFields(entries, "tps port").count).toBe(0);
  });
});

describe("fieldProblem", () => {
  it("checks bounds and whole numbers from the schema", () => {
    expect(fieldProblem({ type: "number", exclusiveMinimum: 0 }, 0)).toEqual({ key: "field.notAbove", vars: { min: 0 } });
    expect(fieldProblem({ type: "integer", minimum: 1, maximum: 65535 }, 70000)).toEqual({ key: "field.aboveMax", vars: { max: 65535 } });
    expect(fieldProblem({ type: "integer", minimum: 1 }, 0)).toEqual({ key: "field.belowMin", vars: { min: 1 } });
    expect(fieldProblem({ type: "integer" }, 1.5)).toEqual({ key: "field.notInteger", vars: {} });
    expect(fieldProblem({ type: "number", minimum: 1 }, undefined)).toBeNull();
    expect(fieldProblem({ type: "number", minimum: 1 }, 5)).toBeNull();
  });

  it("checks a string pattern and leaves an empty string alone", () => {
    const node = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" };
    expect(fieldProblem(node, "25:00")?.key).toBe("field.pattern");
    expect(fieldProblem(node, "08:30")).toBeNull();
    expect(fieldProblem(node, "")).toBeNull();
  });
});

describe("attachErrors", () => {
  const entries = walkFields(props, doc, defs);

  it("puts a line on the field it names, or on the nearest shown field above it", () => {
    const out = attachErrors(
      entries,
      [
        "  - servers.smp.apiUrl: must start with http:// or https://",
        "  - servers.smp.unknownKey: not allowed",
        "  - nowhere: unknown",
        "Something without a path",
      ],
      parseFieldError,
    );
    expect(out.byPath.get(JSON.stringify(["servers", "smp", "apiUrl"]))).toEqual(["must start with http:// or https://"]);
    expect(out.byPath.get(JSON.stringify(["servers", "smp"]))).toEqual(["unknownKey: not allowed"]);
    expect(out.general).toEqual(["nowhere: unknown", "Something without a path"]);
  });

  it("maps a reported path into the form's own", () => {
    const out = attachErrors(entries, ["  - guilds.123.webui.port: too big"], parseFieldError, (p) =>
      p[0] === "guilds" ? p.slice(2) : p,
    );
    expect(out.byPath.get(JSON.stringify(["webui", "port"]))).toEqual(["too big"]);
  });
});

describe("diffDocs", () => {
  it("lists changed leaves, added and removed keys, and compares lists whole", () => {
    const before = { a: 1, nested: { x: "1", y: [1, 2] }, gone: true };
    const after = { a: 1, nested: { x: "2", y: [1, 2, 3] }, added: "new" };
    expect(diffDocs(before, after)).toEqual([
      { path: ["nested", "x"], before: "1", after: "2" },
      { path: ["nested", "y"], before: [1, 2], after: [1, 2, 3] },
      { path: ["gone"], before: true, after: undefined },
      { path: ["added"], before: undefined, after: "new" },
    ]);
  });

  it("ignores key order", () => {
    expect(diffDocs({ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } })).toEqual([]);
  });
});

describe("small helpers", () => {
  it("reads a value by path through objects and lists", () => {
    expect(valueAt(doc, ["servers", "smp", "apiUrl"])).toBe("http://10.0.0.12:3100");
    expect(valueAt(doc, ["chatBridge", "0", "channelId"])).toBe("1");
    expect(valueAt(doc, ["nope", "deeper"])).toBeUndefined();
  });

  it("makes DOM ids from paths", () => {
    expect(fieldDomId("cfg", ["guilds", "1180", "chatBridge.0"])).toBe("cfg-guilds-1180-chatBridge_0");
  });

  it("humanises keys with their acronyms", () => {
    expect(humanizeKey("apiUrl")).toBe("API URL");
    expect(humanizeKey("tpsPollIntervalMs")).toBe("TPS poll interval ms");
    expect(humanizeKey("allowedServerIds")).toBe("Allowed server IDs");
    expect(humanizeKey("hostAlerts")).toBe("Host alerts");
  });

  it("knows the config.json secrets", () => {
    expect(isSecretConfigPath(["token"])).toBe(true);
    expect(isSecretConfigPath(["servers", "smp", "apiKey"])).toBe(true);
    expect(isSecretConfigPath(["servers", "smp", "rconPassword"])).toBe(true);
    expect(isSecretConfigPath(["servers", "smp", "apiUrl"])).toBe(false);
    expect(isSecretConfigPath(["guilds", "1", "token"])).toBe(false);
  });
});

describe("configGroups", () => {
  it("groups known keys in table order and puts unknown keys in Other", () => {
    const groups = configGroups(["webui", "token", "servers", "brandNewThing", "tpsWarningThreshold"]);
    expect(groups.map((g) => [g.id, g.keys])).toEqual([
      ["bot", ["token"]],
      ["servers", ["servers"]],
      ["alerts", ["tpsWarningThreshold"]],
      ["web", ["webui"]],
      ["other", ["brandNewThing"]],
    ]);
  });
});
