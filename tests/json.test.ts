import { describe, expect, test } from "bun:test";
import { parseJsonObject, parseJsonArray } from "../src/json";

describe("LLM JSON parsing", () => {
  test("parses fenced arrays", () => {
    expect(parseJsonArray("```json\n[{\"id\":\"a\"}]\n```")[0].id).toBe("a");
  });

  test("extracts an object surrounded by prose", () => {
    expect(parseJsonObject("selected:\n{\"selectedId\":\"b\"}\ndone").selectedId).toBe("b");
  });

  test("throws on malformed output", () => {
    expect(() => parseJsonArray("not json")).toThrow("JSON array");
  });
});
