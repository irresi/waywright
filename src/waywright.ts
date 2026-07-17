import { resolve } from "node:path";
import { ask } from "./claude";
import { createClaudeNavigator } from "./claude-navigator";
import { gatherEngineeringContext } from "./context";
import { GBrainCliPageStore, GBrainEngineeringMemory } from "./memory";
import { navigate } from "./navigator";
import { writeNavigationArtifacts } from "./artifacts";
import { findReferenceRepos, cloneReference, mineDecisions } from "./steal";
import { fetchRepositoryIntelligence } from "./zero";

if (import.meta.main) {
  const goalArg = process.argv[2];
  if (!goalArg) {
    console.error("usage: bun run src/waywright.ts <goal.md|goal text>");
    process.exit(1);
  }

  const targetDir = resolve(process.env.TARGET_DIR ?? process.cwd());
  const goalFile = Bun.file(resolve(goalArg));
  const goal = await goalFile.exists() ? await goalFile.text() : goalArg;
  const outputDir = resolve(targetDir, ".waywright");
  const memory = new GBrainEngineeringMemory(new GBrainCliPageStore());

  console.log("[MEMORY] recalling prior decisions and outcomes from gbrain");
  console.log("[NAVIGATOR] observing engineering context");
  const deps = createClaudeNavigator({
    ask,
    recallMemory: observedGoal => memory.recall(observedGoal),
    gatherContext: observedGoal => gatherEngineeringContext(observedGoal, targetDir),
    scoutPriorArt: async (observedGoal, candidate) => {
      console.log(`[SCOUT] ${candidate.title}`);
      const query = `${observedGoal}\n\nCandidate direction: ${candidate.title}\nHypothesis: ${candidate.hypothesis}`;
      const repos = (await findReferenceRepos(query)).slice(0, 1);
      const decisions = [];
      for (const repo of repos) {
        const intelligence = fetchRepositoryIntelligence(repo);
        if (intelligence) {
          console.log(`[ZERO] verified ${repo} via paid capability run ${intelligence.runId}`);
          decisions.push({
            repo,
            directionId: candidate.id,
            decision: "Preflight repository trust before adopting its design patterns",
            why: `Zero.xyz capability run ${intelligence.runId}: ${JSON.stringify(intelligence.body).slice(0, 600)}`,
          });
        }
        const dir = cloneReference(repo);
        if (dir) decisions.push(...await mineDecisions(repo, dir, query));
      }
      return decisions;
    },
  });

  const result = await navigate(goal.trim(), deps);
  await writeNavigationArtifacts(result, outputDir);
  console.log(`[DECIDE] ${result.selected.title}`);
  console.log(`[RATIONALE] ${result.decision.rationale}`);
  console.log(`[PLAN] ${outputDir}/plan.md`);
}
