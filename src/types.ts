export interface StolenDecision {
  repo: string;
  decision: string;
  why: string;
  directionId?: string;
}

export interface EngineeringMemoryRecord {
  id: string;
  createdAt: string;
  goal: string;
  selectedDirection: string;
  rationale: string;
  rejected: Array<{ direction: string; reason: string }>;
  evidence: string[];
  outcome: {
    status: "passed" | "failed" | "denied" | "unknown";
    summary: string;
    buildUrl?: string;
    pr?: number;
  };
  lessons: string[];
}

export interface ContextSignal {
  source: string;
  summary: string;
  evidence: string;
  url?: string;
}

export interface CandidateDirection {
  id: string;
  title: string;
  hypothesis: string;
  acceptanceCriteria: string[];
}

export interface DirectionDecision {
  selectedId: string;
  rationale: string;
  rejected: Array<{ id: string; reason: string }>;
  evidence: string[];
}

export interface NavigationResult {
  goal: string;
  memory: EngineeringMemoryRecord[];
  context: ContextSignal[];
  candidates: CandidateDirection[];
  priorArt: StolenDecision[];
  decision: DirectionDecision;
  selected: CandidateDirection;
  plan: string;
}

export interface BuildResult {
  state: "passed" | "failed" | "failing" | "running" | "scheduled" | "canceled";
  number: number;
  webUrl: string;
  failedLogs?: string;
}
