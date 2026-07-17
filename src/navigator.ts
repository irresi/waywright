import type {
  CandidateDirection,
  ContextSignal,
  DirectionDecision,
  EngineeringMemoryRecord,
  NavigationResult,
  StolenDecision,
} from "./types";

export interface NavigatorDeps {
  recallMemory?(goal: string): Promise<EngineeringMemoryRecord[]>;
  gatherContext(goal: string): Promise<ContextSignal[]>;
  generateCandidates(goal: string, context: ContextSignal[], memory: EngineeringMemoryRecord[]): Promise<CandidateDirection[]>;
  scoutPriorArt(goal: string, candidate: CandidateDirection): Promise<StolenDecision[]>;
  selectDirection(input: {
    goal: string;
    memory: EngineeringMemoryRecord[];
    context: ContextSignal[];
    candidates: CandidateDirection[];
    priorArt: StolenDecision[];
  }): Promise<DirectionDecision>;
  makePlan(goal: string, selected: CandidateDirection, decision: DirectionDecision, priorArt: StolenDecision[]): Promise<string>;
}

export async function navigate(goal: string, deps: NavigatorDeps): Promise<NavigationResult> {
  const [memory, context] = await Promise.all([
    deps.recallMemory?.(goal) ?? Promise.resolve([]),
    deps.gatherContext(goal),
  ]);
  const candidates = await deps.generateCandidates(goal, context, memory);
  if (candidates.length < 1) throw new Error("navigator produced no candidate directions");

  const priorArt = (await Promise.all(
    candidates.map(candidate => deps.scoutPriorArt(goal, candidate)),
  )).flat();
  const decision = await deps.selectDirection({ goal, memory, context, candidates, priorArt });
  const selected = candidates.find(candidate => candidate.id === decision.selectedId);
  if (!selected) throw new Error(`direction selector chose unknown candidate: ${decision.selectedId}`);

  const plan = await deps.makePlan(goal, selected, decision, priorArt);
  return { goal, memory, context, candidates, priorArt, decision, selected, plan };
}
