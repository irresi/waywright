// The loop. spec → plan(steal) → implement → CI → observe → self-correct → gate → merge → teach.
import { ask } from "./claude";
import { createBuild, waitForBuild, failedLogs, annotate } from "./buildkite";
import { findReferenceRepos, cloneReference, mineDecisions, writePlan } from "./steal";
import { requestMergeApproval } from "./gate";
import type { LoopState, LoopEvent, Phase } from "./types";
import { spawnSync } from "bun";

const WORKDIR = process.env.TARGET_DIR ?? "./target";

function sh(cmd: string[], cwd = WORKDIR): { ok: boolean; out: string } {
  const r = spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  return { ok: r.exitCode === 0, out };
}

function log(state: LoopState, phase: Phase, summary: string, detail?: string) {
  const ev: LoopEvent = { ts: new Date().toISOString(), phase, summary, detail };
  state.log.push(ev);
  console.log(`[${ev.ts}] ${phase.toUpperCase()}: ${summary}`);
  Bun.write(".ouroboros/state.json", JSON.stringify(state, null, 2));
}

async function narrate(state: LoopState, style: "info" | "warning" | "error" | "success", md: string) {
  if (!state.buildNumber) return;
  try { await annotate(state.buildNumber, md, style, `ouroboros-iter-${state.iteration}`); }
  catch (e) { console.error(`annotate failed: ${e}`); }
}

export async function runLoop(specPath: string, opts: { maxIterations?: number } = {}): Promise<LoopState> {
  const spec = await Bun.file(specPath).text();
  const state: LoopState = {
    phase: "plan", specPath, targetRepo: process.env.TARGET_REPO ?? "",
    branch: `ouroboros/${Date.now()}`, iteration: 0,
    maxIterations: opts.maxIterations ?? 4, log: [],
  };

  // ── PLAN: steal prior art, then plan ──────────────────────────────
  log(state, "plan", "finding prior art to steal from");
  const refs = await findReferenceRepos(spec);
  state.stolen = [];
  for (const repo of refs) {
    const dir = cloneReference(repo);
    if (!dir) { log(state, "plan", `clone failed: ${repo}`); continue; }
    const decisions = await mineDecisions(repo, dir, spec);
    state.stolen.push(...decisions);
    log(state, "plan", `stole ${decisions.length} decisions from ${repo}`);
  }
  state.planPath = ".ouroboros/plan.md";
  await writePlan(spec, state.stolen, state.planPath);
  log(state, "plan", `plan written (${state.stolen.length} stolen decisions folded in)`);

  // ── IMPLEMENT ─────────────────────────────────────────────────────
  state.phase = "implement";
  sh(["git", "checkout", "-b", state.branch]);
  const plan = await Bun.file(state.planPath).text();
  log(state, "implement", "implementing from plan");
  await ask(
    `Implement this plan in the current repo. Write the code AND the tests the plan specifies. ` +
    `Keep diffs minimal. Do not touch CI config.\n\n${plan}`,
    { allowTools: true, maxTurns: 40, cwd: WORKDIR },
  );
  sh(["git", "add", "-A"]);
  sh(["git", "commit", "-m", "ouroboros: implement from plan"]);
  sh(["git", "push", "-u", "origin", state.branch]);
  const head = sh(["git", "rev-parse", "HEAD"]).out.trim();
  log(state, "implement", `pushed ${head.slice(0, 7)} on ${state.branch}`);

  // ── CI → OBSERVE → SELF-CORRECT loop ─────────────────────────────
  while (state.iteration < state.maxIterations) {
    state.phase = "ci";
    const build = await createBuild(state.branch, "HEAD", `ouroboros iter ${state.iteration}`);
    state.buildNumber = build.number;
    log(state, "ci", `build #${build.number} created → ${build.webUrl}`);
    await narrate(state, "info",
      `**Ouroboros iteration ${state.iteration}** — plan: ${state.stolen?.length ?? 0} stolen decisions. Watching this build.`);

    state.phase = "observe";
    const result = await waitForBuild(build.number);
    log(state, "observe", `build #${build.number} → ${result.state}`);

    if (result.state === "passed") {
      await narrate(state, "success", `**Green.** Loop closed in ${state.iteration + 1} iteration(s). Requesting merge approval from the policy gate.`);
      break;
    }

    // red → diagnose and patch
    state.phase = "correct";
    const logs = await failedLogs(build.number);
    log(state, "correct", "diagnosing failure from CI logs");
    const diagnosis = await ask(
      `CI failed. Diagnose the root cause from these logs, then fix the code in the current repo with a MINIMAL diff. ` +
      `After fixing, output one line starting with "DIAGNOSIS: " summarizing root cause and fix.\n\nLogs:\n${logs.slice(0, 8000)}`,
      { allowTools: true, maxTurns: 30, cwd: WORKDIR },
    );
    const diagLine = diagnosis.split("\n").find(l => l.startsWith("DIAGNOSIS:")) ?? diagnosis.slice(0, 200);
    await narrate(state, "warning", `**Self-correction ${state.iteration + 1}:** ${diagLine}`);
    sh(["git", "add", "-A"]);
    sh(["git", "commit", "-m", `ouroboros: self-correct iter ${state.iteration + 1} — ${diagLine.slice(0, 60)}`]);
    sh(["git", "push"]);
    state.iteration++;
    log(state, "correct", diagLine);
  }

  if (state.iteration >= state.maxIterations) {
    state.phase = "failed";
    log(state, "failed", `gave up after ${state.maxIterations} iterations`);
    await narrate(state, "error", `Loop budget exhausted (${state.maxIterations}). Human needed — this is the safety rail, not a bug.`);
    return state;
  }

  // ── GATE → MERGE ──────────────────────────────────────────────────
  state.phase = "gate";
  const pr = sh(["gh", "pr", "create", "--fill", "--head", state.branch]);
  const prUrl = pr.out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? "";
  state.prNumber = Number(prUrl.split("/").pop()) || undefined;
  log(state, "gate", `PR ${prUrl} — requesting policy approval`);

  const verdict = await requestMergeApproval({
    repo: state.targetRepo, pr: state.prNumber ?? 0,
    iterations: state.iteration, buildUrl: `build #${state.buildNumber}`,
  });
  log(state, "gate", `gate verdict: ${verdict.allowed ? "ALLOW" : "DENY"} (${verdict.reason}) via ${verdict.via}`);

  if (!verdict.allowed) {
    state.phase = "failed";
    await narrate(state, "error", `Merge DENIED by policy gate: ${verdict.reason}`);
    return state;
  }

  state.phase = "merge";
  const merged = sh(["gh", "pr", "merge", String(state.prNumber), "--squash", "--delete-branch"]);
  log(state, "merge", merged.ok ? "merged" : `merge failed: ${merged.out.slice(0, 200)}`);
  await narrate(state, "success", `**Merged** under policy approval. Generating the human-context episode.`);

  // ── TEACH: repay the human's cognitive debt ───────────────────────
  state.phase = "teach";
  const teach = sh([
    "bun", "run", `${process.env.HUMAN_MEM_DIR ?? ""}/extractors/pr/extract.ts`,
    "--repo", state.targetRepo, "--pr", String(state.prNumber),
  ], process.env.HUMAN_MEM_DIR ?? WORKDIR);
  log(state, "teach", teach.ok ? "episode generated" : `episode generation failed: ${teach.out.slice(0, 200)}`);

  state.phase = "done";
  log(state, "done", "loop fully closed: spec → merged code → human understanding");
  return state;
}

if (import.meta.main) {
  const specPath = process.argv[2];
  if (!specPath) { console.error("usage: bun run src/loop.ts <spec.md>"); process.exit(1); }
  runLoop(specPath).then(s => process.exit(s.phase === "done" ? 0 : 1));
}
