import { spawnSync } from "bun";
import { join } from "node:path";
import type { ContextSignal } from "./types";

function command(args: string[], cwd: string): string {
  const result = spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : "";
}

export async function gatherEngineeringContext(goal: string, cwd = process.cwd()): Promise<ContextSignal[]> {
  const signals: ContextSignal[] = [];
  const packageFile = Bun.file(join(cwd, "package.json"));
  if (await packageFile.exists()) {
    const pkg = await packageFile.json() as { name?: string; scripts?: Record<string, string> };
    signals.push({
      source: "repository",
      summary: `${pkg.name ?? "unnamed repository"} — goal: ${goal}`,
      evidence: `available scripts: ${Object.keys(pkg.scripts ?? {}).join(", ") || "none"}`,
    });
  }

  const readmeFile = Bun.file(join(cwd, "README.md"));
  if (await readmeFile.exists()) {
    signals.push({
      source: "readme",
      summary: "Current project description",
      evidence: (await readmeFile.text()).slice(0, 1500),
    });
  }

  const history = command(["git", "log", "-5", "--pretty=format:%h %s"], cwd);
  if (history) signals.push({ source: "git", summary: "Recent engineering history", evidence: history });
  const status = command(["git", "status", "--short"], cwd);
  signals.push({ source: "worktree", summary: status ? "Worktree has changes" : "Worktree is clean", evidence: status || "clean" });
  return signals;
}
