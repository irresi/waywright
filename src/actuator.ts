import type { BuildResult } from "./types";

export interface ActuatorDeps {
  implement(plan: string): Promise<string>;
  build(branch: string, iteration: number): Promise<BuildResult>;
  observe(build: BuildResult): Promise<"passed" | "failed">;
  failedLogs(build: BuildResult): Promise<string>;
  correct(input: { plan: string; branch: string; logs: string; iteration: number }): Promise<string>;
  openPullRequest(branch: string): Promise<number>;
  requestGate(input: { pr: number; iterations: number; build: BuildResult }): Promise<{ allowed: boolean; reason: string }>;
  merge(pr: number): Promise<void>;
  narrate(event: ActuatorEvent): Promise<void>;
}

export interface ActuatorEvent {
  phase: "implement" | "build" | "observe" | "correct" | "gate" | "merge" | "stopped";
  summary: string;
  iteration: number;
  build?: BuildResult;
}

export interface ActuatorResult {
  status: "merged" | "denied" | "exhausted";
  branch: string;
  iterations: number;
  builds: BuildResult[];
  pr?: number;
  reason?: string;
}

export async function actuate(
  plan: string,
  deps: ActuatorDeps,
  options: { maxIterations?: number } = {},
): Promise<ActuatorResult> {
  const maxIterations = options.maxIterations ?? 3;
  let iterations = 0;
  const builds: BuildResult[] = [];
  const branch = await deps.implement(plan);
  await deps.narrate({ phase: "implement", summary: `implemented on ${branch}`, iteration: iterations });

  let greenBuild: BuildResult | undefined;
  while (!greenBuild) {
    const build = await deps.build(branch, iterations);
    builds.push(build);
    await deps.narrate({ phase: "build", summary: `build #${build.number} started`, iteration: iterations, build });
    const state = await deps.observe(build);
    await deps.narrate({ phase: "observe", summary: `build #${build.number} ${state}`, iteration: iterations, build });
    if (state === "passed") {
      greenBuild = { ...build, state: "passed" };
      break;
    }
    if (iterations >= maxIterations) {
      await deps.narrate({ phase: "stopped", summary: "correction budget exhausted", iteration: iterations, build });
      return { status: "exhausted", branch, iterations, builds };
    }
    const logs = await deps.failedLogs(build);
    const summary = await deps.correct({ plan, branch, logs, iteration: iterations + 1 });
    iterations += 1;
    await deps.narrate({ phase: "correct", summary, iteration: iterations, build });
  }

  const pr = await deps.openPullRequest(branch);
  const verdict = await deps.requestGate({ pr, iterations, build: greenBuild });
  await deps.narrate({ phase: "gate", summary: `${verdict.allowed ? "ALLOW" : "DENY"}: ${verdict.reason}`, iteration: iterations, build: greenBuild });
  if (!verdict.allowed) return { status: "denied", branch, iterations, builds, pr, reason: verdict.reason };

  await deps.merge(pr);
  await deps.narrate({ phase: "merge", summary: `merged PR #${pr}`, iteration: iterations, build: greenBuild });
  return { status: "merged", branch, iterations, builds, pr };
}
