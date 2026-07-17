#!/usr/bin/env bun
/**
 * core/cli-render.ts — render an episode spec to HTML.
 *
 * Usage:
 *   bun core/cli-render.ts <spec.json> [out.html]
 *   bun core/cli-render.ts episodes/hermes-agent-pr-62413.spec.json
 *
 * Validates first (grammar D-006, fair-play, referential integrity), then renders
 * through the shared core renderer. Loads the canonical learner model so
 * concept-intro depth reflects prior exposure (D-005).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { EpisodeSpec } from "./types";
import { validateSpec } from "./validate";
import { renderEpisode } from "./render";
import { loadLearner } from "./learner";

const [specPath, outPathArg] = process.argv.slice(2);
if (!specPath) {
  console.error("usage: bun core/cli-render.ts <spec.json> [out.html]");
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, "utf8")) as EpisodeSpec;

const { ok, errors, warnings } = validateSpec(spec);
for (const w of warnings) console.warn(`⚠ ${w}`);
if (!ok) {
  console.error(`✗ spec invalid (${errors.length} error(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const outPath = outPathArg ?? specPath.replace(/\.spec\.json$/, ".html").replace(/\.json$/, ".html");
const lm = loadLearner();
const html = renderEpisode(spec, lm);
writeFileSync(outPath, html);
console.log(`✓ ${spec.id}: ${spec.panels.length} panels, ${spec.quiz.length} quiz Q → ${outPath}`);
