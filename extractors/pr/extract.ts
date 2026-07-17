#!/usr/bin/env bun
/**
 * extractors/pr/extract.ts — PR → episode spec → HTML (Phase 1 pipeline).
 *
 * Usage:
 *   bun extractors/pr/extract.ts <owner/repo> <pr-number> [--out-dir episodes]
 *   bun extractors/pr/extract.ts NousResearch/hermes-agent 62413
 *   bun extractors/pr/extract.ts <owner/repo> <pr> --spec-only   # skip HTML
 *   bun extractors/pr/extract.ts <owner/repo> <pr> --dry-run     # gather+prompt only
 *
 * Runs on the user's Claude subscription via the local CLI (D-011). Validates the
 * model's spec (D-006 grammar, fair-play, referential integrity) and retries once
 * with the validation errors fed back before giving up. Renders through the shared
 * core (D-016) so PR mode and the future session pipeline stay identical.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpisodeSpec } from "../../core/types";
import { validateSpec } from "../../core/validate";
import { renderEpisode } from "../../core/render";
import { scanSpec } from "../../core/slopscan";
import { loadLearner, recordExposure, saveLearner } from "../../core/learner";
import { gatherPR, gradeDensity } from "./gather";
import { buildExtractionPrompt, slugFor } from "./prompt";
import { claudeCliProvider, extractJsonObject, type LlmProvider } from "./claude";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, "..", "..", "spec", "episode-spec.schema.json");

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function runExtraction(prompt: string, provider: LlmProvider): Promise<EpisodeSpec> {
  // The CLI is non-deterministic: it occasionally returns prose, a truncated
  // object, or an empty result instead of the JSON spec. That failure happens at
  // PARSE time (before validation), so the validator's own retry never sees it.
  // Retry the call itself up to 3x on a parse failure before giving up.
  const MAX = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const raw = await provider.complete(prompt);
      const json = extractJsonObject(raw);
      return JSON.parse(json) as EpisodeSpec;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX) {
        console.error(`  extract attempt ${attempt}/${MAX} returned no valid JSON (${(e as Error).message}); retrying ...`);
      }
    }
  }
  throw new Error(`extraction failed after ${MAX} attempts: ${(lastErr as Error)?.message ?? lastErr}`);
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const [repo, numStr] = pos;
  if (!repo || !numStr) {
    console.error("usage: bun extractors/pr/extract.ts <owner/repo> <pr-number> [--out-dir DIR] [--spec-only] [--dry-run]");
    process.exit(2);
  }
  const number = Number(numStr);
  const outDir = (flags["out-dir"] as string) ?? join(HERE, "..", "..", "episodes");

  console.error(`● gathering ${repo}#${number} via gh ...`);
  const pr = await gatherPR(repo, number);
  const density = gradeDensity(pr);
  console.error(`  ${pr.files.length} files, ${pr.comments.length} comments, ${pr.reviews.length} reviews, ${pr.relatedPRs.length} related PRs, ${pr.linkedIssues.length} issues → density: ${density}`);

  const prompt = buildExtractionPrompt(pr, density, SCHEMA);

  if (flags["dry-run"]) {
    const p = join("/tmp", `${slugFor(pr)}.prompt.txt`);
    writeFileSync(p, prompt);
    console.error(`✓ dry run — prompt (${prompt.length} chars) written to ${p}`);
    return;
  }

  console.error(`● extracting spec via ${claudeCliProvider.name} ...`);
  let spec = await runExtraction(prompt, claudeCliProvider);
  let { ok, errors, warnings } = validateSpec(spec);

  if (!ok) {
    console.error(`  first pass had ${errors.length} error(s); retrying once with feedback ...`);
    const fixPrompt = `${prompt}\n\n## Your previous output FAILED validation with these errors:\n${errors.map((e) => `- ${e}`).join("\n")}\nEmit a corrected JSON object that fixes ALL of them.`;
    spec = await runExtraction(fixPrompt, claudeCliProvider);
    ({ ok, errors, warnings } = validateSpec(spec));
  }

  for (const w of warnings) console.error(`  ⚠ ${w}`);
  if (!ok) {
    console.error(`✗ spec still invalid after retry (${errors.length} error(s)):`);
    for (const e of errors) console.error(`  - ${e}`);
    // persist the broken spec for inspection
    const bad = join("/tmp", `${slugFor(pr)}.invalid.spec.json`);
    writeFileSync(bad, JSON.stringify(spec, null, 2));
    console.error(`  broken spec saved to ${bad}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const slug = spec.id || slugFor(pr);
  const specPath = join(outDir, `${slug}.spec.json`);
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.error(`✓ spec → ${specPath}`);

  // advisory AI-slop scan (non-blocking): surface structural/phrasal tells so the
  // author can tighten prose. High/med hits are worth a manual pass; low (em-dash)
  // is a nudge, not a failure. Never blocks the build.
  const slopHits = scanSpec(spec as unknown as Parameters<typeof scanSpec>[0]);
  if (slopHits.length) {
    const hi = slopHits.filter((h) => h.severity === "high").length;
    const me = slopHits.filter((h) => h.severity === "med").length;
    const lo = slopHits.filter((h) => h.severity === "low").length;
    console.error(`  slop-scan: ${slopHits.length} hit(s) — high:${hi} med:${me} low:${lo}${hi + me > 0 ? " (worth a manual pass; run `bun core/cli-slopscan.ts " + specPath + "`)" : ""}`);
  } else {
    console.error("  slop-scan: clean ✓");
  }

  if (!flags["spec-only"]) {
    const lm = loadLearner();
    const html = renderEpisode(spec, lm);
    const htmlPath = join(outDir, `${slug}.html`);
    writeFileSync(htmlPath, html);
    // record exposure to the canonical learner model (server-side mirror of the browser ledger)
    saveLearner(recordExposure(lm, spec));
    console.error(`✓ html → ${htmlPath}`);
  }
  console.log(specPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
