import { describe, expect, test } from "bun:test";
import { actuate } from "../src/actuator";

function deps(states: Array<"failed" | "passed">, gateAllowed = true) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      implement: async () => { calls.push("implement"); return "feature/waywright"; },
      build: async () => { calls.push("build"); return { number: calls.filter(x => x === "build").length, webUrl: "https://build", state: "running" as const }; },
      observe: async () => { calls.push("observe"); return states.shift() ?? "failed"; },
      failedLogs: async () => { calls.push("logs"); return "expected 200, got 500"; },
      correct: async () => { calls.push("correct"); return "handle duplicate key"; },
      openPullRequest: async () => { calls.push("pr"); return 7; },
      requestGate: async () => { calls.push("gate"); return { allowed: gateAllowed, reason: gateAllowed ? "policy passed" : "denied" }; },
      merge: async () => { calls.push("merge"); },
      narrate: async () => {},
    },
  };
}

describe("actuator", () => {
  test("self-corrects a failed build and merges only after green plus gate approval", async () => {
    const test = deps(["failed", "passed"]);
    const result = await actuate("# Plan", test.value, { maxIterations: 3 });

    expect(result.status).toBe("merged");
    expect(result.iterations).toBe(1);
    expect(result.builds).toHaveLength(2);
    expect(test.calls).toEqual(["implement", "build", "observe", "logs", "correct", "build", "observe", "pr", "gate", "merge"]);
  });

  test("does not merge when policy denies", async () => {
    const test = deps(["passed"], false);
    const result = await actuate("# Plan", test.value);

    expect(result.status).toBe("denied");
    expect(test.calls).not.toContain("merge");
  });

  test("stops when the correction budget is exhausted", async () => {
    const test = deps(["failed", "failed", "failed"]);
    const result = await actuate("# Plan", test.value, { maxIterations: 2 });

    expect(result.status).toBe("exhausted");
    expect(result.iterations).toBe(2);
    expect(test.calls).not.toContain("pr");
  });
});
