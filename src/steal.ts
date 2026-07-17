// Plan phase — "steal" prior art before writing a line of code.
// The agent finds the closest open-source reference, shallow-clones it,
// mines its design decisions, and folds them into its own plan.
import { ask } from "./claude";
import { spawnSync } from "bun";
import type { StolenDecision } from "./types";
import { mkdirSync, existsSync } from "node:fs";

const REF_DIR = ".waywright/reference";

export async function findReferenceRepos(spec: string): Promise<string[]> {
  const q = await ask(
    `Given this software spec, output ONLY a JSON array (no prose) of up to 2 GitHub "owner/repo" strings that are the best-known open-source implementations of the same kind of thing — canonical references worth studying before building. Spec:\n${spec}`,
  );
  try {
    const arr = JSON.parse(q.replace(/```json?|```/g, "").trim());
    return Array.isArray(arr) ? arr.slice(0, 2) : [];
  } catch { return []; }
}

export function cloneReference(repo: string): string | null {
  mkdirSync(REF_DIR, { recursive: true });
  const dest = `${REF_DIR}/${repo.replace("/", "__")}`;
  if (existsSync(dest)) return dest;
  const r = spawnSync(["git", "clone", "--depth", "1", `https://github.com/${repo}.git`, dest]);
  return r.exitCode === 0 ? dest : null;
}

export async function mineDecisions(repo: string, dir: string, spec: string): Promise<StolenDecision[]> {
  const out = await ask(
    `You are inside a shallow clone of ${repo} at ${dir}. Read its README and key source files. ` +
    `Extract up to 3 design decisions that we should STEAL for building this spec:\n${spec}\n` +
    `Output ONLY a JSON array of {"decision": "...", "why": "..."} — concrete, implementation-level decisions, no fluff.`,
    { allowTools: true, maxTurns: 15, cwd: dir },
  );
  try {
    const m = out.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : out);
    return arr.map((d: any) => ({ repo, decision: d.decision, why: d.why }));
  } catch { return []; }
}

export async function writePlan(spec: string, stolen: StolenDecision[], planPath: string): Promise<void> {
  const stolenMd = stolen.map(s => `- **${s.decision}** (from ${s.repo}) — ${s.why}`).join("\n") || "- (no prior art found; planning from first principles)";
  const plan = await ask(
    `Write a concise implementation plan (markdown) for this spec. Incorporate the stolen design decisions where they fit. ` +
    `The plan must list: files to create, the test that proves it works, and acceptance criteria.\n\n` +
    `## Spec\n${spec}\n\n## Stolen design decisions\n${stolenMd}\n\nOutput ONLY the markdown plan.`,
  );
  await Bun.write(planPath, `# Plan (auto-generated)\n\n## Stolen prior art\n${stolenMd}\n\n${plan}\n`);
}
