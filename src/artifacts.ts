import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { NavigationResult } from "./types";

export async function writeNavigationArtifacts(result: NavigationResult, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const candidates = result.candidates.map(candidate => {
    const selected = candidate.id === result.selected.id ? " **SELECTED**" : "";
    return `### ${candidate.title}${selected}\n${candidate.hypothesis}\n\nAcceptance: ${candidate.acceptanceCriteria.join("; ")}`;
  }).join("\n\n");
  const rejected = result.decision.rejected.map(item => `- ${item.id}: ${item.reason}`).join("\n") || "- none";
  const evidence = result.decision.evidence.map(item => `- ${item}`).join("\n") || "- none";
  const priorArt = result.priorArt.map(item => `- **${item.decision}** — ${item.why} ([${item.repo}](https://github.com/${item.repo}))`).join("\n") || "- none";
  const memory = result.memory.map(item => `- **${item.id}: ${item.selectedDirection}** — ${item.rationale}\n  - Outcome: ${item.outcome.summary}\n  - Lessons: ${item.lessons.join("; ") || "none"}`).join("\n") || "- none recalled";
  const markdown = `# Direction Decision\n\n## Goal\n${result.goal}\n\n## Recalled Engineering Memory\n${memory}\n\n## Candidates\n${candidates}\n\n## Selected: ${result.selected.title}\n${result.decision.rationale}\n\n## Rejected\n${rejected}\n\n## Evidence\n${evidence}\n\n## Prior art\n${priorArt}\n`;

  await Promise.all([
    Bun.write(join(outputDir, "direction.md"), markdown),
    Bun.write(join(outputDir, "navigation.json"), JSON.stringify(result, null, 2)),
    Bun.write(join(outputDir, "plan.md"), result.plan),
  ]);
}
