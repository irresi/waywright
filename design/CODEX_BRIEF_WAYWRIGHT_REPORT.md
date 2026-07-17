# Codex brief — Waywright cognitive-debt UI

## Scope

Implement ONLY these files in this repository. Do not modify any other file and do not commit:

- `src/report.ts` — pure `renderWaywrightReport(model): string`, returns a complete self-contained HTML document
- `src/render-report.ts` — CLI that reads `.waywright/navigation.json`, optional `.waywright/actuation.json`, optional `.waywright/memory-written.json`, writes `.waywright/report.html`
- `tests/report.test.ts` — focused structural test of the renderer (real data, no snapshots)

## Product

Waywright is a memory-governed engineering agent. It recalls why prior decisions were made and what happened, forms three candidate directions, selects one with evidence, executes it through CI/self-correction/policy/merge, then writes the decision and outcome back to shared Engineering Memory.

Tagline: `Give it a goal, not a ticket.`

The UI reduces human cognitive debt by letting a developer reconstruct the decision, not merely monitor build status.

## Surface

Primary surface: **Command / Inspect**. Secondary: Monitor.

This is NOT a marketing landing page and NOT a generic metrics dashboard. No hero, no feature cards, no fake stats.

The key question the page answers: `Why did the agent choose this direction, and what will it remember next time?`

## Data contract

Import existing types from `src/types.ts` and `src/actuator.ts`.

```ts
export interface WaywrightReportModel {
  navigation: NavigationResult;
  actuation?: ActuatorResult;
  memoryWritten?: EngineeringMemoryRecord;
}

export function renderWaywrightReport(model: WaywrightReportModel): string;
```

NavigationResult includes:
- goal
- memory[] (recalled EngineeringMemoryRecord)
- context[]
- candidates[]
- decision.selectedId/rationale/rejected/evidence
- selected
- priorArt[]
- plan

ActuatorResult includes status, iterations, builds, PR, reason.
Memory record includes selected direction, rejected alternatives, outcome, lessons.

Never invent data. Empty/missing fields get honest empty states.

## Composition

Desktop first at 1440×900, responsive down to 900px.

Persistent top bar:
- wordmark `WAYWRIGHT / RUN RECORD`
- tagline small
- run status at right (`NAVIGATED`, `MERGED`, `DENIED`, `EXHAUSTED`)

Main layout:

1. Thin left rail, 260px: **RECALLED MEMORY**
   - each memory as compact row with ID, prior selected direction, outcome status
   - clicking a memory highlights every evidence string in the center containing that ID
   - empty state: `No prior memory. First run starts from current evidence.`

2. Main center, flexible: decision reconstruction
   - Goal at top, not a hero
   - three candidate direction rows stacked vertically, not equal feature cards
   - selected candidate is expanded and marked `SELECTED`
   - rejected candidates show the actual rejection reason inline
   - selected rationale and evidence appear as connected supporting rows
   - prior-art decisions show repo provenance

3. Right rail, 300px: **EXECUTION TRACE**
   - timeline from implementation → Buildkite build(s) → correction(s) → Pomerium gate → merge
   - Buildkite steps carry a `BUILDKITE` label and use actual build URL when present
   - gate row carries `POMERIUM`
   - a pending actuation uses an honest pending state, not fake success

Bottom full-width drawer: **MEMORY WRITTEN**
- shows the exact new decision/outcome/lessons that the next run will recall
- visually expresses feedback from execution back to memory
- if absent: `Written after execution completes.`

Interactions:
- keyboard-accessible tabs/buttons
- left memory click highlighting as above
- `Focus selected` button dims rejected paths; toggles back to `Show all`
- `Replay decision` button reveals sections in causal order: recalled memory → candidates → selected rationale → execution → memory written. It should animate quickly and respect reduced-motion.
- no localStorage needed

## Visual system

Original, serious engineering tool.

- Background: warm near-black `#11110f`
- Elevated surfaces: `#181814`, `#20201b`
- Ink: warm white `#f2efe6`
- Muted: `#969385`
- Accent: safety amber `#f0a83b`
- Success: restrained green `#6fbd83`
- Danger: coral red `#e06a55`
- Border: `#343329`
- Typography: local/system only, deliberate combination: `ui-monospace, SFMono-Regular` for labels/data and `-apple-system, BlinkMacSystemFont, "Segoe UI"` for prose. No remote assets.
- Squared/compact geometry: 4–8px radii, no pill overload.
- No gradients, no glassmorphism, no indigo/violet/blue accent, no decorative icons, no giant rounded rectangles, no made-up numeric metrics.
- Use typographic hierarchy, rules, spacing, and state color rather than card decoration.

## Security

All user/model strings MUST be HTML-escaped. Embed no external scripts, fonts, or assets. JSON data must not be interpreted as HTML.

## Acceptance

- `bun test tests/report.test.ts` passes
- `bun run typecheck` passes
- HTML contains no external resource URLs
- renderer HTML-escapes `<script>alert(1)</script>` supplied as the goal
- report includes actual memory IDs, candidate titles, rejected reasons, build states, sponsor labels, and memory-written lessons from the model
- responsive CSS present
- no blue/indigo/violet/purple/gradient strings in CSS or copy
- only the three scoped files changed
