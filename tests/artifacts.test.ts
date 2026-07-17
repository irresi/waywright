import { afterEach, describe, expect, test } from "bun:test";
import { writeNavigationArtifacts } from "../src/artifacts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe("navigation artifacts", () => {
  test("persists auditable candidates, decision, evidence, and plan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waywright-artifacts-"));
    dirs.push(dir);
    await writeNavigationArtifacts({
      goal: "find direction",
      memory: [{
        id: "D-001",
        createdAt: "2026-07-17T18:00:00.000Z",
        goal: "past goal",
        selectedDirection: "Past direction",
        rationale: "past rationale",
        rejected: [],
        evidence: ["build passed"],
        outcome: { status: "passed", summary: "worked" },
        lessons: ["advance this pattern"],
      }],
      context: [{ source: "git", summary: "history", evidence: "commit" }],
      candidates: [{ id: "a", title: "A", hypothesis: "h", acceptanceCriteria: ["done"] }],
      priorArt: [{ repo: "x/y", decision: "pattern", why: "proven", directionId: "a" }],
      decision: { selectedId: "a", rationale: "best", rejected: [], evidence: ["git: commit"] },
      selected: { id: "a", title: "A", hypothesis: "h", acceptanceCriteria: ["done"] },
      plan: "# Plan\nDo it",
    }, dir);

    const decision = await Bun.file(join(dir, "direction.md")).text();
    expect(decision).toContain("Selected: A");
    expect(decision).toContain("Recalled Engineering Memory");
    expect(decision).toContain("D-001");
    expect(decision).toContain("x/y");
    expect(await Bun.file(join(dir, "navigation.json")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "plan.md")).text()).toContain("Do it");
  });
});
