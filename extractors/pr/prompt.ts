/**
 * extractors/pr/prompt.ts — builds the extraction prompt that turns gathered PR
 * data into an EpisodeSpec JSON. Pure string assembly; no side effects.
 *
 * The prompt encodes the product's craft rules (from ideation/goal.md &
 * decisions.md) so the model produces a spec that already obeys the fixed
 * grammar (D-006), fair-play predictions, and the seductive-details rule.
 */
import type { GatheredPR } from "./gather";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function buildExtractionPrompt(pr: GatheredPR, density: string, schemaPath: string): string {
  const schema = readFileSync(schemaPath, "utf8");
  const data = JSON.stringify(pr, null, 2);

  return `You are the human-mem PR extractor. Turn one merged pull request into an
interactive-comic EPISODE SPEC (JSON) that helps a human rebuild the situation model of
what changed — not a summary, a learning artifact that forces retrieval.

## Output contract
Emit ONLY a single JSON object conforming to the schema below. No prose, no markdown
fences. It will be validated programmatically; invalid JSON or schema violations fail.

## Craft rules (non-negotiable)
1. FIXED GRAMMAR (long-form): cold-open → incident → concept-intro(s) → investigation →
   ≥2 competing hypothesis panels → exactly ONE prediction panel → reveal → code-walk →
   resolution → ratification → teaser. The prediction panel MUST come BEFORE reveal.
   For "four-panel" density: incident → one hypothesis/investigation → prediction →
   reveal, plus quiz + map. For "map-update-only": no panels needed beyond a terse
   incident; just concepts (optional), an empty-ish arc, quiz optional, map REQUIRED.
2. EVERYTHING TRACES TO SOURCE. Every fact — file names, decisions, numbers, quotes —
   must come from the gathered data. Never invent a file, a person, a test count, or a
   quote. If you don't know, omit it. Fabrication is the cardinal failure.
3. DECISION-MIMICKING QUIZZES. 3–5 quiz items that test whether the reader could make
   the next DECISION in this area — not trivia (no "what's the return type"). Each
   option needs feedback; wrong-answer feedback explains WHY the intuition fails, kindly
   (hypercorrection).
4. FAIR-PLAY PREDICTION. The single prediction panel's answer must be inferable from the
   panels BEFORE it (a reader who's never seen this repo can reason to it from the story
   + general engineering intuition). Provide per-option feedback; give "half credit"
   framing to partially-right options.
5. CONCEPTS AS CHARACTER INTROS. For each non-obvious concept, give a one_liner (for
   readers who've seen it) and a full intro (for first-timers). Max ~4 concepts; only
   those the causal chain actually needs. The full intro may use an analogy WHEN IT
   GENUINELY CLARIFIES — but DO NOT open every concept with one. Across all concepts in
   the episode, AT MOST HALF may start with an analogy ("Imagine…", "Think of…",
   "Picture…", "Like a…"); the rest must lead with the plain mechanism in concrete terms.
   A parade of "Imagine…/Think of…" openers is a template tell — vary the entry.
5a. DEFINITION AT POINT OF USE (mandatory, enforced by the validator). Each concept's
   \`name\` OR one of its \`aliases\` MUST appear verbatim (word-boundary, case-insensitive)
   in at least one panel \`body\` — that's what lets the renderer attach the definition
   tooltip the first time the term shows up in the prose. So: USE the term in the
   narration (don't describe the idea only in generic words), and list the exact surface
   forms you used in \`aliases\` (see rule 9). A concept whose term never appears in any
   body FAILS validation.
6. SEDUCTIVE-DETAILS RULE. Cast = only people/agents who carry causal structure
   (competing-PR authors, the maintainer, the bug reporter). No decorative characters.
7. THE MAP ALWAYS GROWS. map_updates: what this change adds to the codebase's shape +
   any invariant/house-rule it establishes.
8. INTUITION FIGURES — visual before text (dual coding). Add a \`figure\` to panels
   where a picture builds intuition faster than prose. You emit STRUCTURED DATA only
   (the renderer draws the SVG — never write SVG/markup yourself). Pick the type that
   matches the causal shape, and put the figure on a NARRATION panel (no \`speaker\`):
   - \`scene\` — an ANIMATIC that PLAYS OUT the specific incident so the reader SEES it
     happen. STRONGLY PREFERRED on the cold-open (and/or incident). Define \`actors\`
     (the concrete things in this bug — e.g. "Session A", "Session B", "Composer",
     "Draft store") each with an id, label, optional semantic \`kind\`, and an x,y
     position on a 0..100 stage (x=left→right, y=top→bottom; spread them out).
     Then write ordered \`steps\` that dramatize THIS bug, each with a short \`note\`
     caption:
       {action:"appear", actor, note}                 — a thing enters the scene
       {action:"type", actor, text, note}             — text is entered into an actor
       {action:"move", actor, to, text, note}         — a token travels A→to
       {action:"flow", actor, to, label?, fault?, note} — an arrow A→to; fault:true = the
                                                           WRONG path (the bug moment)
       {action:"flash", actor, fault?, note}          — an actor pulses (error)
       {action:"vanish", actor, note}                 — a thing disappears ("message gone")
     Order matters — tell the story: e.g. Session A appears → Session B appears →
     type long message into B → user switches to A → debounce timer fires →
     flow(draft→A, fault) "saved into the WRONG session" → vanish(B's message).
     USE ANIMATED SCENES GENEROUSLY — they carry understanding better than static
     diagrams. Aim for 2–3 scenes per long-form episode (not just the cold-open):
       • cold-open (REQUIRED) — dramatize the incident as it happens.
       • the mechanism beat (investigation OR reveal) — when the fix/bug unfolds
         step-by-step over TIME, animate it as a scene rather than flattening it
         into a static \`sequence\`. Seeing the steps play beats reading a list.
       • optionally one more on a second time-based beat if the causal chain has a
         distinct second act.
     Each scene: 5–9 steps, its own \`actors\`. Only use a scene where the content is
     genuinely temporal (things happen in order); a purely structural relationship
     stays a \`flow\`/\`architecture\`. Don't force a scene onto a beat with no motion.
   - \`flow\` — things moving between components; a wrong/error path is an edge with
     kind:"fault". Good for a compact "message goes A→B but drifts to X".
   - \`sequence\` — ordered events in time; mark the breaking step fault:true. Good on
     investigation ("typed → wait → switch → wrong save").
   - \`compare\` — before vs after the fix, two short bullet lists. Good on resolution.
   - \`architecture\` — components in layers with semantic \`kind\`
     (frontend/backend/database/cloud/security/bus/external); mark changed nodes
     touched:true; connect with edges. Good for "what this PR touched".
   Every figure must carry causal structure — no decoration (seductive-details rule).
   Aim for: 2–3 animated \`scene\`s on the time-based beats (cold-open + investigation/
   reveal) + one \`compare\` (before/after the fix) + optionally one \`architecture\`/
   \`flow\` (the structural shape). Favor a \`scene\` over a static \`sequence\` whenever
   the steps happen in time. map-update-only may skip figures.
   Do NOT put figures on hypothesis/cast-intro/concept-intro/ratification panels —
   those are text beats and render without a filler image.
9. TERM ALIASES (REQUIRED — the validator rejects a concept that isn't term-linkable).
   For each concept, set \`aliases\`: the EXACT surface forms it appears as in your panel
   bodies. At least one of {name, aliases, spaced-id} MUST occur verbatim in some \`body\`
   (rule 5a). Empty aliases on a concept whose name doesn't literally appear in the prose
   = validation failure. The renderer term-links the FIRST occurrence to a hover tooltip
   (definition at point of use), so aliases must match words you actually wrote.
10. PLAIN, HONEST PROSE — no filler, no hype (anti-slop). Write like a sharp engineer
   explaining to a peer, not marketing copy:
   - NO throat-clearing / filler: 'in other words', 'simply put', 'needless to say',
     'it is worth noting', 'at the end of the day', 'essentially', 'basically'. Say the
     thing directly instead.
   - NO hype adjectives for the code/fix: 'elegant', 'powerful', 'robust', 'seamless',
     'magical', 'beautiful', 'game-changing', 'under the hood'. Describe what it does,
     not how impressive it is.
   - Metaphors EARN their place or are cut — one analogy that clarifies beats three
     decorative ones. Do not stack similes or over-extend a metaphor past its point.
   - Prefer concrete nouns/verbs from THIS codebase (the real file, function, session,
     ref) over generic abstractions. Specificity is the anti-slop signal.
   - NO STRUCTURAL SLOP (these tells read as machine-written regardless of wording;
     catalog from hardikpandya/stop-slop + Wikipedia "Signs of AI writing"):
     • No binary-contrast reversals: "it's not X, it's Y" / "the problem isn't X, it's
       Y" / "not because X but because Y". State Y directly.
     • No negative-listing runway: "not just X but also Y" / "It wasn't X. It wasn't Y.
       It was Z." Say what it IS.
     • No meta-narration / tour-guide voice: "we'll look at", "let's walk through",
       "in this section", "as we'll see", or "-ing" analysis verbs (diving into,
       unpacking, exploring how). The prose should MOVE, not announce its own path.
     • No throat-clearing openers: "Here's the thing", "It turns out", "The truth is",
       "Make no mistake". Open on the point.
     • No inflated significance: "the implications are significant", "this fundamentally
       changes", "a game-changer". Show the specific consequence or cut it.
     • No false agency (inanimate thing with a human verb): "the data tells us", "the
       diff decides", "the bug becomes a fix". Name the actual person/actor (or "you").
     • Avoid rule-of-three puffery — a padded triple parallel ("fast, clean, and
       correct") is slop unless all three items carry real, distinct weight.
     • Em-dashes: at most one per short passage. Prefer commas/periods; two+ em-dashes
       in one body reads as AI. (A deterministic scanner, core/slopscan.ts, flags all
       of the above post-extraction — write so it stays quiet.)

## Narrative density (pre-graded): ${density}

## Gathered PR data (your ONLY source of truth)
\`\`\`json
${data}
\`\`\`

## Episode Spec JSON schema
\`\`\`json
${schema}
\`\`\`

Set spec_version to "0.1". Set id to a slug like "${slugFor(pr)}". Populate source from
the gathered data (repo, pr_number, issue_numbers, related_prs, merged_at, urls). Write
in a clear, causal, concrete style — build intuition before detail, but in plain
engineer's prose (rule 10): no filler, no hype, analogies only where they truly clarify
and never on every concept.

Emit the JSON object now.`;
}

export function slugFor(pr: GatheredPR): string {
  return `${pr.repo.split("/").pop()}-pr-${pr.number}`.toLowerCase();
}
