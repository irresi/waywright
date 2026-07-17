import { describe, test, expect } from "bun:test";
import { searchCapabilities } from "../src/zero";
import { requestMergeApproval } from "../src/gate";

describe("gate fail-closed", () => {
  test("unreachable gate denies merge", async () => {
    process.env.GATE_URL = "http://localhost:59999/gate/merge"; // nothing there
    const v = await requestMergeApproval({ repo: "x/y", pr: 1, iterations: 1, buildUrl: "b" });
    expect(v.allowed).toBe(false);
    expect(v.via).toBe("fail-closed");
  });
});

describe("zero capability search", () => {
  test("returns array (possibly empty) without throwing", () => {
    const caps = searchCapabilities("code review", 0.1);
    expect(Array.isArray(caps)).toBe(true);
  });
});
