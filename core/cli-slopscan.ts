#!/usr/bin/env bun
/**
 * cli-slopscan.ts — scan episode specs for AI-slop patterns.
 * Usage: bun core/cli-slopscan.ts [spec.json ...]   (defaults to episodes/*.spec.json)
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { scanSpec, formatReport, type SlopHit } from "./slopscan";

const args = process.argv.slice(2);
const files = args.length
  ? args
  : globSync("episodes/*.spec.json");

let total = 0;
const bySev: Record<string, number> = { high: 0, med: 0, low: 0 };
for (const f of files.sort()) {
  const spec = JSON.parse(readFileSync(f, "utf8"));
  const hits: SlopHit[] = scanSpec(spec);
  total += hits.length;
  for (const h of hits) bySev[h.severity]!++;
  console.log(formatReport(f.split("/").pop() ?? f, hits));
  console.log("");
}
console.log(`── TOTAL: ${total} hits across ${files.length} decks (high:${bySev.high} med:${bySev.med} low:${bySev.low}) ──`);
