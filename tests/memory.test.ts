import { describe, expect, test } from "bun:test";
import { GBrainEngineeringMemory, type GBrainPageStore } from "../src/memory";
import type { EngineeringMemoryRecord } from "../src/types";

class InMemoryPageStore implements GBrainPageStore {
  content = "";
  async get(): Promise<string | null> { return this.content || null; }
  async put(_slug: string, content: string): Promise<void> { this.content = content; }
}

const record = (overrides: Partial<EngineeringMemoryRecord> = {}): EngineeringMemoryRecord => ({
  id: "D-001",
  createdAt: "2026-07-17T18:00:00.000Z",
  goal: "Reduce cognitive debt from autonomous code",
  selectedDirection: "Interactive prediction checkpoint",
  rationale: "Prediction verifies understanding instead of assuming it.",
  rejected: [{ direction: "Passive summary", reason: "Reading does not prove understanding" }],
  evidence: ["Buildkite build #1 failed, then passed after one correction"],
  outcome: { status: "passed", summary: "Build passed after one correction" },
  lessons: ["Do not propose passive summaries again"],
  ...overrides,
});

describe("gbrain engineering memory", () => {
  test("starts empty when the gbrain page does not exist", async () => {
    const memory = new GBrainEngineeringMemory(new InMemoryPageStore());
    expect(await memory.recall("anything")).toEqual([]);
  });

  test("writes a structured decision and reads it back from the gbrain page", async () => {
    const store = new InMemoryPageStore();
    const memory = new GBrainEngineeringMemory(store);

    await memory.remember(record());
    const recalled = await memory.recall("cognitive debt");

    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.id).toBe("D-001");
    expect(recalled[0]?.rejected[0]?.direction).toBe("Passive summary");
    expect(store.content).toContain("type: engineering-memory");
    expect(store.content).toContain("```json memory");
  });

  test("upserts the same decision id without duplicating it", async () => {
    const store = new InMemoryPageStore();
    const memory = new GBrainEngineeringMemory(store);

    await memory.remember(record());
    await memory.remember(record({ lessons: ["Updated lesson"] }));

    const recalled = await memory.recall("cognitive debt");
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.lessons).toEqual(["Updated lesson"]);
  });

  test("returns the most relevant memories before unrelated ones", async () => {
    const store = new InMemoryPageStore();
    const memory = new GBrainEngineeringMemory(store);
    await memory.remember(record());
    await memory.remember(record({
      id: "D-002",
      goal: "Reduce deployment cost",
      selectedDirection: "Compress assets",
      rationale: "Smaller bundles cost less",
      rejected: [],
      evidence: [],
      outcome: { status: "passed", summary: "Bundle shrank" },
      lessons: ["Prefer compression"],
    }));

    const recalled = await memory.recall("How should we explain autonomous code changes?", 1);
    expect(recalled[0]?.id).toBe("D-001");
  });
});
