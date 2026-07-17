import { describe, expect, test } from "bun:test";
import { fetchRepositoryIntelligence } from "../src/zero";

describe("Zero repository intelligence", () => {
  test("buys a bounded repository preflight capability and returns its report", () => {
    let invoked: string[] = [];
    const report = fetchRepositoryIntelligence("NousResearch/hermes-agent", undefined, args => {
      invoked = args;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          runId: "run-1",
          ok: true,
          payment: { amount: "0.001", currency: "USDC" },
          body: { health_score: 92, license: "MIT", recent_activity: true },
        }),
        stderr: "",
      };
    });

    expect(invoked).toContain("--max-pay");
    expect(invoked).toContain("0.03");
    expect(invoked.join(" ")).toContain("repo=NousResearch%2Fhermes-agent");
    expect(report?.runId).toBe("run-1");
    expect(report?.body.health_score).toBe(92);
  });

  test("returns null instead of inventing evidence when the capability call fails", () => {
    const report = fetchRepositoryIntelligence("x/y", 0.001, () => ({ exitCode: 1, stdout: "", stderr: "failed" }));
    expect(report).toBeNull();
  });
});
