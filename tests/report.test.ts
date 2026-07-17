import { describe, expect, test } from "bun:test";
import type { WaywrightReportModel } from "../src/report";
import { renderWaywrightReport } from "../src/report";

const model: WaywrightReportModel = {
  navigation: {
    goal: "Explain <script>alert(1)</script> without hiding the tradeoff",
    memory: [{
      id: "MEM-014",
      createdAt: "2026-07-12T18:00:00.000Z",
      goal: "Make autonomous changes legible",
      selectedDirection: "Decision reconstruction",
      rationale: "Operators need causes, not counters.",
      rejected: [{ direction: "Status dashboard", reason: "It reports state without reasoning." }],
      evidence: ["Interview notes"],
      outcome: { status: "passed", summary: "The run record reduced review time.", buildUrl: "https://buildkite.example/builds/40", pr: 40 },
      lessons: ["Keep the evidence attached to the decision."],
    }],
    context: [{ source: "operator-interview", summary: "Reviewers ask why.", evidence: "MEM-014 showed reviewers reconstruct decisions before approving." }],
    candidates: [
      { id: "monitor", title: "Live status monitor", hypothesis: "Expose every running event.", acceptanceCriteria: ["Show current state"] },
      { id: "record", title: "Causal run record", hypothesis: "Reconstruct the choice and its evidence.", acceptanceCriteria: ["Connect evidence to direction", "Return outcomes to memory"] },
      { id: "digest", title: "End-of-run digest", hypothesis: "Summarize after execution.", acceptanceCriteria: ["Produce a concise digest"] },
    ],
    priorArt: [{ repo: "acme/agent-console", decision: "Place evidence beside decisions", why: "MEM-014 made review causality explicit", directionId: "record" }],
    decision: {
      selectedId: "record",
      rationale: "A causal record answers why the agent chose this direction.",
      rejected: [
        { id: "monitor", reason: "Monitoring alone does not reconstruct the decision." },
        { id: "digest", reason: "A digest separates evidence from the moment of choice." },
      ],
      evidence: ["MEM-014 showed decision context mattered more than event volume."],
    },
    selected: { id: "record", title: "Causal run record", hypothesis: "Reconstruct the choice and its evidence.", acceptanceCriteria: ["Connect evidence to direction", "Return outcomes to memory"] },
    plan: "Implement the causal run record.",
  },
  actuation: {
    status: "merged",
    branch: "feature/run-record",
    iterations: 1,
    builds: [
      { number: 41, state: "failed", webUrl: "https://buildkite.example/builds/41" },
      { number: 42, state: "passed", webUrl: "https://buildkite.example/builds/42" },
    ],
    pr: 88,
  },
  memoryWritten: {
    id: "MEM-015",
    createdAt: "2026-07-17T19:00:00.000Z",
    goal: "Explain the tradeoff",
    selectedDirection: "Causal run record",
    rationale: "Evidence stays beside the selected direction.",
    rejected: [{ direction: "Live status monitor", reason: "It cannot explain why." }],
    evidence: ["MEM-014"],
    outcome: { status: "passed", summary: "Merged PR #88 after one correction.", buildUrl: "https://buildkite.example/builds/42", pr: 88 },
    lessons: ["Keep recalled evidence visible during execution.", "Write the correction outcome back to memory."],
  },
};

describe("Waywright report", () => {
  test("renders a secure, self-contained decision record from real model data", () => {
    const html = renderWaywrightReport(model);

    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("WAYWRIGHT / RUN RECORD");
    expect(html).toContain("MEM-014");
    expect(html).toContain("Causal run record");
    expect(html).toContain("Monitoring alone does not reconstruct the decision.");
    expect(html).toContain("failed");
    expect(html).toContain("passed");
    expect(html).toContain("BUILDKITE");
    expect(html).toContain("POMERIUM");
    expect(html).toContain("Keep recalled evidence visible during execution.");
    expect(html).toContain('href="https://buildkite.example/builds/42"');
    expect(html).toContain("@media (max-width: 1120px)");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/(?:blue|indigo|violet|purple|gradient)/i);
  });
});
