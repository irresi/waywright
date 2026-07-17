import type { NavigatorDeps } from "./navigator";
import type { CandidateDirection, ContextSignal, DirectionDecision, EngineeringMemoryRecord, StolenDecision } from "./types";
import { parseJsonArray, parseJsonObject } from "./json";

interface ClaudeNavigatorOptions {
  ask(prompt: string): Promise<string>;
  recallMemory?(goal: string): Promise<EngineeringMemoryRecord[]>;
  gatherContext(goal: string): Promise<ContextSignal[]>;
  scoutPriorArt(goal: string, candidate: CandidateDirection): Promise<StolenDecision[]>;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export function createClaudeNavigator(options: ClaudeNavigatorOptions): NavigatorDeps {
  return {
    recallMemory: options.recallMemory,
    gatherContext: options.gatherContext,

    async generateCandidates(goal, context, memory) {
      const output = await options.ask(
        `You are the Navigator of a memory-governed, self-directing engineering agent. Given a high-level goal, observed context, and prior engineering memory, propose exactly 3 distinct candidate directions. Advance prior successful decisions and do not repeat approaches that memory already rejected unless new evidence reverses the reason. Do not merely restate the goal. Each direction must be implementable and falsifiable. Output ONLY a JSON array of {"id":"kebab-case","title":"...","hypothesis":"...","acceptanceCriteria":["..."]}.\n\nGOAL:\n${goal}\n\nRECALLED ENGINEERING MEMORY:\n${json(memory)}\n\nCURRENT CONTEXT:\n${json(context)}`,
      );
      return parseJsonArray<CandidateDirection>(output);
    },

    async scoutPriorArt(goal, candidate) {
      const decisions = await options.scoutPriorArt(goal, candidate);
      return decisions.map(decision => ({ ...decision, directionId: candidate.id }));
    },

    async selectDirection(input) {
      const output = await options.ask(
        `Choose the strongest direction for the goal using recalled engineering memory, current context, and prior-art evidence. Optimize for impact, novelty, feasibility, and testability. Treat prior outcomes as evidence: advance successful patterns and explicitly explain any reversal of a remembered rejection. Explicitly reject every non-selected candidate. Output ONLY a JSON object of {"selectedId":"...","rationale":"...","rejected":[{"id":"...","reason":"..."}],"evidence":["source: concrete fact"]}. Never select an id outside the candidates.\n\nINPUT:\n${json(input)}`,
      );
      return parseJsonObject<DirectionDecision>(output);
    },

    async makePlan(goal, selected, decision, priorArt) {
      return options.ask(
        `Turn the selected direction into an implementation plan for an autonomous coding actuator. Include scope, files, RED/GREEN tests, acceptance criteria, and explicit non-goals. Cite adopted prior-art decisions. Output ONLY markdown.\n\nGOAL:\n${goal}\n\nSELECTED:\n${json(selected)}\n\nDECISION:\n${json(decision)}\n\nPRIOR ART:\n${json(priorArt.filter(item => !item.directionId || item.directionId === selected.id))}`,
      );
    },
  };
}
