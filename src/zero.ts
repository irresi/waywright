// Zero.xyz integration — mid-loop capability acquisition.
// When the agent hits a gap it can't close with local tools, it SEARCHES the
// Zero capability market and (if affordable) buys the call with its own wallet.
import { spawnSync } from "bun";

export interface Capability {
  id?: string;
  name: string;
  description?: string;
  cost?: string;
  url?: string;
}

export function searchCapabilities(query: string, maxCostUsd = 0.5): Capability[] {
  const r = spawnSync(["zero", "search", query, "--json", "--limit", "5", "--max-cost", String(maxCostUsd)], {
    stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(r.stdout));
    const items = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.capabilities ?? [];
    return items.map((c: any) => ({
      id: c.id, name: c.name ?? c.title ?? "unknown",
      description: c.description, cost: c.cost ?? c.price, url: c.url,
    }));
  } catch { return []; }
}

export function walletStatus(): string {
  const r = spawnSync(["zero", "auth", "whoami"], { stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(r.stdout).trim();
}

const REPOSITORY_INTELLIGENCE_CAPABILITY = "netintel-production-440c-up-railway-app-b48cd8a6";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (args: string[]) => CommandResult;

export interface RepositoryIntelligenceReport {
  runId: string;
  ok: boolean;
  payment?: { amount?: string; currency?: string };
  body: Record<string, unknown>;
}

function runZero(args: string[]): CommandResult {
  const result = spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

export function fetchRepositoryIntelligence(
  repo: string,
  maxPayUsd = 0.03,
  runner: CommandRunner = runZero,
): RepositoryIntelligenceReport | null {
  const encodedRepo = encodeURIComponent(repo);
  const result = runner([
    "zero", "fetch",
    "--capability", REPOSITORY_INTELLIGENCE_CAPABILITY,
    "--max-pay", String(maxPayUsd),
    "--timeout", "30",
    "--json",
    `https://netintel-production-440c.up.railway.app/github-intel/analyze?repo=${encodedRepo}`,
  ]);
  if (result.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as RepositoryIntelligenceReport;
    return parsed.ok && parsed.body && typeof parsed.body === "object" ? parsed : null;
  } catch {
    return null;
  }
}
