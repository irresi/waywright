import { describe, expect, test } from "bun:test";
import { createClaudeNavigator } from "../src/claude-navigator";
import { navigate } from "../src/navigator";

describe("Claude navigator adapter", () => {
  test("parses candidates, decision, and plan through the navigator contract", async () => {
    const answers = [
      `[{"id":"docs","title":"Generate docs","hypothesis":"docs help","acceptanceCriteria":["docs exist"]},{"id":"episode","title":"Learning episode","hypothesis":"prediction proves understanding","acceptanceCriteria":["episode exists"]}]`,
      `{"selectedId":"episode","rationale":"measurable","rejected":[{"id":"docs","reason":"passive"}],"evidence":["repo: pattern"]}`,
      "# Plan\nBuild the learning episode",
    ];
    const prompts: string[] = [];
    const deps = createClaudeNavigator({
      ask: async prompt => {
        prompts.push(prompt);
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected LLM call");
        return answer;
      },
      gatherContext: async () => [{ source: "repo", summary: "fresh repo", evidence: "2 commits" }],
      scoutPriorArt: async (_goal, candidate) => [{ repo: `oss/${candidate.id}`, decision: "pattern", why: "works" }],
    });

    const result = await navigate("reduce cognitive debt", deps);

    expect(result.selected.id).toBe("episode");
    expect(result.plan).toContain("learning episode");
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("distinct candidate directions");
  });
});
