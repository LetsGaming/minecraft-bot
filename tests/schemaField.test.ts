/**
 * QUAL-08 — the config form's field classifier and $ref resolver. These are
 * the pure decisions behind SchemaField.vue (which the headless test env can't
 * render), exercised against nodes shaped like the real generated schema.
 */
import { describe, it, expect } from "vitest";
import {
  derefNode,
  classifyField,
  arrayEnumOptions,
  mapValueSchema,
  arrayItemSchema,
} from "../src/web/frontend/src/components/schemaField.js";

// A slice of the generated schema's definitions.
const defs = {
  RawBotConfig: {
    type: "object",
    properties: {
      token: { type: "string" },
      adminUsers: { type: "array", items: { type: "string" } },
    },
  },
  NotificationEvent: {
    type: "string",
    enum: ["join", "leave", "death", "advancement", "start", "stop"],
  },
  ServerScope: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
};

describe("derefNode", () => {
  it("resolves a #/definitions ref to the concrete node", () => {
    expect(derefNode({ $ref: "#/definitions/NotificationEvent" }, defs).enum).toHaveLength(6);
  });
  it("resolves the root ref (topRef) so the form can read properties", () => {
    const root = derefNode({ $ref: "#/definitions/RawBotConfig" }, defs);
    expect(Object.keys(root.properties ?? {})).toContain("token");
  });
  it("returns the node unchanged when there is no ref", () => {
    expect(derefNode({ type: "string" }, defs).type).toBe("string");
  });
  it("degrades gracefully on an unknown or missing ref", () => {
    expect(derefNode({ $ref: "#/definitions/Nope" }, defs)).toEqual({});
    expect(derefNode(undefined, defs)).toEqual({});
  });
});

describe("classifyField", () => {
  const k = (node: unknown) => classifyField(node as never, defs);

  it("maps scalars and enums", () => {
    expect(k({ type: "boolean" })).toBe("boolean");
    expect(k({ type: "string" })).toBe("string");
    expect(k({ type: "integer" })).toBe("number");
    expect(k({ type: "number" })).toBe("number");
    expect(k({ enum: ["a", "b"] })).toBe("enum");
  });

  it("maps an object with declared properties to a recursible group", () => {
    expect(k({ type: "object", properties: { a: {} } })).toBe("object");
  });

  it("maps an enum-item array (via ref) to a multiselect", () => {
    expect(
      k({ type: "array", items: { $ref: "#/definitions/NotificationEvent" } }),
    ).toBe("multiselect");
  });

  it("maps a string array to chips", () => {
    expect(k({ type: "array", items: { type: "string" } })).toBe("chips");
  });

  it("maps a Record<string,X> (additionalProperties) to a map editor", () => {
    expect(
      k({ type: "object", additionalProperties: { $ref: "#/definitions/RawBotConfig" } }),
    ).toBe("map");
  });

  it("collapses an 'X or X[]' union to the matching list control", () => {
    // ServerScope = string | string[] → chips (not JSON).
    expect(k(defs.ServerScope)).toBe("chips");
    // object | object[] (e.g. chatBridge) → array editor.
    expect(
      k({
        anyOf: [
          { type: "object", properties: {} },
          { type: "array", items: { type: "object", properties: {} } },
        ],
      }),
    ).toBe("array");
  });

  it("maps a number array to a number list", () => {
    expect(k({ type: "array", items: { type: "integer" } })).toBe("numberList");
  });

  it("maps an array of objects to an array editor", () => {
    expect(k({ type: "array", items: { type: "object", properties: {} } })).toBe("array");
  });

  it("falls back to JSON only as a genuine last resort (mixed-type union)", () => {
    // A union that is NOT the X|X[] pattern has no sensible single control.
    expect(k({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("json");
  });
});

describe("map/array item schema helpers", () => {
  it("mapValueSchema returns the additionalProperties schema (deref'd)", () => {
    const v = mapValueSchema(
      { type: "object", additionalProperties: { $ref: "#/definitions/NotificationEvent" } } as never,
      defs,
    );
    expect(v.enum).toHaveLength(6);
  });

  it("arrayItemSchema returns the item schema, including through X|X[]", () => {
    expect(
      arrayItemSchema({ type: "array", items: { type: "string" } } as never, defs).type,
    ).toBe("string");
    // ServerScope collapses to array-of-string → item is a string.
    expect(arrayItemSchema(defs.ServerScope as never, defs).type).toBe("string");
  });
});

describe("arrayEnumOptions", () => {
  it("builds {value,label} options from a ref'd enum", () => {
    const opts = arrayEnumOptions(
      { type: "array", items: { $ref: "#/definitions/NotificationEvent" } } as never,
      defs,
    );
    expect(opts).toContainEqual({ value: "join", label: "join" });
    expect(opts).toHaveLength(6);
  });
  it("is empty for a non-enum array", () => {
    expect(arrayEnumOptions({ type: "array", items: { type: "string" } } as never, defs)).toEqual([]);
  });
});
