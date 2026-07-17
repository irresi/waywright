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
