import { describe, expect, test } from "bun:test";
import { navigate } from "../src/navigator";
import type { CandidateDirection, ContextSignal, DirectionDecision } from "../src/types";

describe("navigate", () => {
  test("turns a goal into an evidence-backed selected direction", async () => {
    const context: ContextSignal[] = [
      { source: "github", summary: "Existing PR summary bots are crowded", evidence: "three mature tools" },
      { source: "buildkite", summary: "CI failures recur after autonomous changes", evidence: "7 failures" },
    ];
    const candidates: CandidateDirection[] = [
      { id: "summary", title: "PR summary bot", hypothesis: "summaries reduce cognitive debt", acceptanceCriteria: ["summary generated"] },
      { id: "episode", title: "Interactive learning episode", hypothesis: "prediction tests prove understanding", acceptanceCriteria: ["episode generated", "prediction recorded"] },
    ];
    const decision: DirectionDecision = {
      selectedId: "episode",
      rationale: "It creates a measurable understanding loop and avoids a crowded category.",
      rejected: [{ id: "summary", reason: "Crowded and passive" }],
      evidence: ["github: three mature tools", "buildkite: 7 failures"],
    };

    const result = await navigate("Reduce cognitive debt from autonomous coding", {
      gatherContext: async () => context,
      generateCandidates: async () => candidates,
      scoutPriorArt: async (_goal, candidate) => [{
        repo: `example/${candidate.id}`,
        decision: `proven pattern for ${candidate.title}`,
        why: "observed in working prior art",
      }],
      selectDirection: async () => decision,
      makePlan: async (_goal, selected) => `# Plan\nBuild ${selected.title}`,
    });

    expect(result.goal).toBe("Reduce cognitive debt from autonomous coding");
    expect(result.candidates).toHaveLength(2);
    expect(result.selected.id).toBe("episode");
    expect(result.decision.evidence).toContain("github: three mature tools");
    expect(result.priorArt).toHaveLength(2);
    expect(result.plan).toContain("Interactive learning episode");
  });

  test("feeds recalled engineering memory into candidate generation and selection", async () => {
    const memory = [{
      id: "D-001",
      createdAt: "2026-07-17T18:00:00.000Z",
      goal: "Explain autonomous changes",
      selectedDirection: "Interactive prediction",
      rationale: "Prediction verifies understanding",
      rejected: [{ direction: "Passive summary", reason: "Does not verify understanding" }],
      evidence: ["Buildkite build passed after correction"],
      outcome: { status: "passed" as const, summary: "Worked" },
      lessons: ["Do not propose passive summaries again"],
    }];
    let memorySeenByCandidates = false;
    let memorySeenBySelector = false;

    const result = await navigate("Improve future explanations", {
      recallMemory: async () => memory,
      gatherContext: async () => [],
      generateCandidates: async (_goal, _context, recalled) => {
        memorySeenByCandidates = recalled[0]?.id === "D-001";
        return [{ id: "replay", title: "Architecture replay", hypothesis: "builds on prior learning", acceptanceCriteria: ["replay generated"] }];
      },
      scoutPriorArt: async () => [],
      selectDirection: async input => {
        memorySeenBySelector = input.memory[0]?.lessons[0] === "Do not propose passive summaries again";
        return { selectedId: "replay", rationale: "advances prior work", rejected: [], evidence: ["memory:D-001"] };
      },
      makePlan: async () => "plan",
    });

    expect(memorySeenByCandidates).toBe(true);
    expect(memorySeenBySelector).toBe(true);
    expect(result.memory[0]?.id).toBe("D-001");
  });

  test("rejects a selector decision that names an unknown candidate", async () => {
    await expect(navigate("goal", {
      gatherContext: async () => [],
      generateCandidates: async () => [{ id: "a", title: "A", hypothesis: "h", acceptanceCriteria: ["done"] }],
      scoutPriorArt: async () => [],
      selectDirection: async () => ({ selectedId: "missing", rationale: "bad", rejected: [], evidence: [] }),
      makePlan: async () => "plan",
    })).rejects.toThrow("unknown candidate");
  });
});
