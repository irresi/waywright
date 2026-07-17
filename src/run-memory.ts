import type { ActuatorResult } from "./actuator";
import type { EngineeringMemoryRecord, NavigationResult } from "./types";

export function createMemoryRecord(
  navigation: NavigationResult,
  actuation: ActuatorResult,
  identity: { id: string; createdAt: string },
): EngineeringMemoryRecord {
  const titleById = new Map(navigation.candidates.map(candidate => [candidate.id, candidate.title]));
  const finalBuild = actuation.builds.at(-1);
  const outcomeStatus = actuation.status === "merged" ? "passed"
    : actuation.status === "denied" ? "denied"
    : "failed";
  const correctionLesson = actuation.iterations === 1
    ? "The selected direction reached green after one self-correction."
    : actuation.iterations > 1
      ? `The selected direction required ${actuation.iterations} self-corrections before stopping.`
      : "The selected direction reached its final state without self-correction.";

  return {
    ...identity,
    goal: navigation.goal,
    selectedDirection: navigation.selected.title,
    rationale: navigation.decision.rationale,
    rejected: navigation.decision.rejected.map(item => ({
      direction: titleById.get(item.id) ?? item.id,
      reason: item.reason,
    })),
    evidence: [
      ...navigation.decision.evidence,
      ...navigation.priorArt
        .filter(item => !item.directionId || item.directionId === navigation.selected.id)
        .map(item => `${item.repo}: ${item.decision} — ${item.why}`),
    ],
    outcome: {
      status: outcomeStatus,
      summary: actuation.status === "merged"
        ? `Merged PR #${actuation.pr} after ${actuation.iterations} correction(s).`
        : actuation.reason ?? `Run stopped with status ${actuation.status}.`,
      buildUrl: finalBuild?.webUrl,
      pr: actuation.pr,
    },
    lessons: [
      correctionLesson,
      ...navigation.decision.rejected.map(item => `Rejected ${titleById.get(item.id) ?? item.id}: ${item.reason}`),
    ],
  };
}
