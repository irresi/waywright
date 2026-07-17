import { describe, expect, test } from "bun:test";
import { createMemoryRecord } from "../src/run-memory";
import type { NavigationResult } from "../src/types";

const navigation: NavigationResult = {
  goal: "Help humans understand autonomous changes",
  memory: [],
  context: [],
  candidates: [
    { id: "summary", title: "Passive summary", hypothesis: "summarize", acceptanceCriteria: ["summary"] },
    { id: "prediction", title: "Interactive prediction", hypothesis: "verify understanding", acceptanceCriteria: ["prediction"] },
  ],
  priorArt: [{ repo: "x/y", decision: "prediction before reveal", why: "retrieval practice", directionId: "prediction" }],
  decision: {
    selectedId: "prediction",
    rationale: "It verifies understanding.",
    rejected: [{ id: "summary", reason: "Passive reading does not prove understanding" }],
    evidence: ["memory:D-000 showed summaries were ignored"],
  },
  selected: { id: "prediction", title: "Interactive prediction", hypothesis: "verify understanding", acceptanceCriteria: ["prediction"] },
  plan: "# Plan",
};

describe("run memory", () => {
  test("turns direction, rejected alternatives, and real execution outcome into shared memory", () => {
    const record = createMemoryRecord(navigation, {
      status: "merged",
      branch: "waywright/demo",
      iterations: 1,
      builds: [
        { number: 1, state: "failed", webUrl: "https://build/1" },
        { number: 2, state: "passed", webUrl: "https://build/2" },
      ],
      pr: 7,
    }, { id: "D-007", createdAt: "2026-07-17T19:00:00.000Z" });

    expect(record.id).toBe("D-007");
    expect(record.selectedDirection).toBe("Interactive prediction");
    expect(record.rejected).toEqual([{ direction: "Passive summary", reason: "Passive reading does not prove understanding" }]);
    expect(record.outcome.status).toBe("passed");
    expect(record.outcome.buildUrl).toBe("https://build/2");
    expect(record.outcome.pr).toBe(7);
    expect(record.lessons.join(" ")).toContain("one self-correction");
    expect(record.evidence).toContain("memory:D-000 showed summaries were ignored");
  });
});
