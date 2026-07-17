import { spawnSync } from "bun";
import type { ActuatorDeps, ActuatorEvent } from "./actuator";
import { ask } from "./claude";
import { annotate, createBuild, failedLogs, waitForBuild } from "./buildkite";
import { requestMergeApproval } from "./gate";

interface ProductionActuatorOptions {
  targetDir: string;
  targetRepo: string;
}

function shell(args: string[], cwd: string): string {
  const result = spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`.trim();
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${output.slice(0, 1000)}`);
  return output;
}

// Non-throwing variant for commands whose non-zero exit is not fatal
// (e.g. `git commit` when there is nothing to commit).
function shellSoft(args: string[], cwd: string): string {
  const result = spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`.trim();
}

function diagnosisLine(output: string): string {
  return output.split("\n").find(line => line.startsWith("DIAGNOSIS:"))?.slice(11).trim()
    ?? output.split("\n").find(Boolean)?.slice(0, 200)
    ?? "minimal correction applied";
}

export function createProductionActuator(options: ProductionActuatorOptions): ActuatorDeps {
  const { targetDir, targetRepo } = options;
  return {
    async implement(plan) {
      const branch = `waywright/${Date.now()}`;
      shell(["git", "checkout", "-b", branch], targetDir);
      await ask(
        `You are Waywright's coding actuator. Implement the approved plan in this TARGET repository. Follow its RED/GREEN tests, keep the diff minimal, and do not edit CI configuration. Run local tests before finishing. The plan may mention helpers from the Waywright orchestrator that are not present here: adapt those requirements into self-contained target code instead of assuming missing files exist. Use .waywright, never .ouroboros, for generated artifacts. Preserve and commit the existing .waywright direction evidence.\n\n${plan}`,
        { allowTools: true, maxTurns: 40, cwd: targetDir },
      );
      shell(["git", "add", "-A"], targetDir);
      shellSoft(["git", "commit", "-m", "waywright: implement selected direction"], targetDir);
      shell(["git", "push", "-u", "origin", branch], targetDir);
      return branch;
    },

    build(branch, iteration) {
      return createBuild(branch, "HEAD", `Waywright iteration ${iteration}`);
    },

    async observe(build) {
      const result = await waitForBuild(build.number);
      return result.state === "passed" ? "passed" : "failed";
    },

    failedLogs(build) {
      return failedLogs(build.number);
    },

    async correct({ plan, logs, iteration }) {
      const output = await ask(
        `Waywright's real CI failed on iteration ${iteration}. Diagnose the root cause from the logs, make the smallest code-only fix, and run local tests. Do not edit CI configuration. End with one line: DIAGNOSIS: <root cause and correction>.\n\nAPPROVED PLAN:\n${plan}\n\nCI LOGS:\n${logs.slice(0, 10000)}`,
        { allowTools: true, maxTurns: 30, cwd: targetDir },
      );
      const summary = diagnosisLine(output);
      shell(["git", "add", "-A"], targetDir);
      // --allow-empty: a correction that fixed nothing in-tree (e.g. a flaky/env
      // failure) still advances the branch so the next build re-runs cleanly.
      shellSoft(["git", "commit", "--allow-empty", "-m", `waywright: self-correct ${iteration} — ${summary.slice(0, 60)}`], targetDir);
      shell(["git", "push"], targetDir);
      return summary;
    },

    async openPullRequest(branch) {
      const output = shell(["gh", "pr", "create", "--fill", "--head", branch], targetDir);
      const number = Number(output.match(/\/pull\/(\d+)/)?.[1]);
      if (!number) throw new Error(`could not parse PR number from: ${output}`);
      return number;
    },

    async requestGate({ pr, iterations, build }) {
      const verdict = await requestMergeApproval({
        repo: targetRepo,
        pr,
        iterations,
        buildUrl: build.webUrl,
      });
      return { allowed: verdict.allowed, reason: `${verdict.reason} via ${verdict.via}` };
    },

    async merge(pr) {
      shell(["gh", "pr", "merge", String(pr), "--squash", "--delete-branch"], targetDir);
    },

    async narrate(event: ActuatorEvent) {
      console.log(`[${event.phase.toUpperCase()}] ${event.summary}`);
      if (!event.build) return;
      const style = event.phase === "correct" ? "warning"
        : event.phase === "stopped" ? "error"
        : event.phase === "merge" || event.summary.includes("passed") ? "success"
        : "info";
      try {
        await annotate(event.build.number, `**Waywright · ${event.phase}**\n\n${event.summary}`, style, `waywright-${event.phase}-${event.iteration}`);
      } catch (error) {
        console.error(`[ANNOTATE] ${error}`);
      }
    },
  };
}
