// Ouroboros — a self-directing loop agent.
// spec → plan (steal prior art) → implement → CI → observe → self-correct → gate → merge → teach
export type Phase =
  | "plan" | "implement" | "ci" | "observe" | "correct" | "gate" | "merge" | "teach" | "done" | "failed";

export interface LoopState {
  phase: Phase;
  specPath: string;
  targetRepo: string;        // owner/name of the repo the agent builds in
  branch: string;
  iteration: number;         // self-correction attempts
  maxIterations: number;
  buildNumber?: number;      // current Buildkite build
  prNumber?: number;
  planPath?: string;
  stolen?: StolenDecision[];
  log: LoopEvent[];
}

export interface StolenDecision {
  repo: string;              // where we stole it from
  decision: string;          // one-line design decision
  why: string;
}

export interface LoopEvent {
  ts: string;
  phase: Phase;
  summary: string;           // human-readable; also posted as Buildkite annotation
  detail?: string;
}

export interface BuildResult {
  state: "passed" | "failed" | "failing" | "running" | "scheduled" | "canceled";
  number: number;
  webUrl: string;
  failedLogs?: string;
}
