/**
 * core/validate.ts — structural + narrative-grammar validation for episode specs.
 * Enforces what the JSON schema can't: the fixed episode grammar (D-006),
 * fair-play prediction rules, and referential integrity.
 */
import type { EpisodeSpec, Panel, Figure } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const BEAT_ORDER: Record<string, number> = {
  "cold-open": 0,
  incident: 1,
  "cast-intro": 2,
  "concept-intro": 2,
  investigation: 3,
  hypothesis: 4,
  prediction: 5,
  reveal: 6,
  "code-walk": 7,
  resolution: 8,
  ratification: 9,
  teaser: 10,
};

export function validateSpec(spec: EpisodeSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- basics
  if (spec.spec_version !== "0.1") errors.push(`unknown spec_version: ${spec.spec_version}`);
  if (!spec.id) errors.push("missing id");
  if (!spec.title) errors.push("missing title");
  if (!spec.panels?.length) errors.push("no panels");
  if (!spec.source?.kind) errors.push("missing source.kind");

  const conceptIds = new Set(spec.concepts.map((c) => c.id));
  const castIds = new Set((spec.cast ?? []).map((c) => c.id));
  const hypothesisIds = new Set<string>();

  // --- referential integrity + per-panel rules
  spec.panels.forEach((p: Panel, i: number) => {
    const at = `panel[${i}] (${p.beat})`;
    if (!(p.beat in BEAT_ORDER)) errors.push(`${at}: unknown beat`);
    // prediction/concept-intro carry content in structured fields; a code-walk may
    // lean entirely on its code exhibit — so body is optional when a substitute exists
    const hasSubstitute = p.beat === "prediction" || p.beat === "concept-intro"
      || (p.beat === "code-walk" && !!p.code) || !!p.figure;
    if (!p.body && !hasSubstitute) errors.push(`${at}: empty body`);
    if (p.speaker && !castIds.has(p.speaker)) errors.push(`${at}: speaker '${p.speaker}' not in cast`);
    if (p.figure) validateFigure(p.figure, at, errors);
    if (p.beat === "concept-intro") {
      if (!p.concept_ref) errors.push(`${at}: concept-intro without concept_ref`);
      else if (!conceptIds.has(p.concept_ref)) errors.push(`${at}: concept_ref '${p.concept_ref}' not in concepts`);
    }
    if (p.beat === "hypothesis") {
      if (!p.hypothesis_id) errors.push(`${at}: hypothesis without hypothesis_id`);
      else hypothesisIds.add(p.hypothesis_id);
    }
    if (p.beat === "prediction") {
      if (!p.prediction) { errors.push(`${at}: prediction beat without prediction object`); return; }
      validatePrediction(p.prediction, at, errors, conceptIds);
      for (const o of p.prediction.options) {
        if (o.maps_to_hypothesis && !hypothesisIds.has(o.maps_to_hypothesis))
          errors.push(`${at}: option '${o.id}' maps to unknown hypothesis '${o.maps_to_hypothesis}'`);
      }
    }
  });

  // --- fixed grammar (D-006), long-form only
  if (spec.narrative_density === "long-form") {
    const beats = spec.panels.map((p) => p.beat);
    const required: Panel["beat"][] = ["incident", "hypothesis", "prediction", "reveal", "resolution"];
    for (const r of required) if (!beats.includes(r)) errors.push(`long-form grammar: missing required beat '${r}'`);

    const predIdx = beats.indexOf("prediction");
    const revealIdx = beats.indexOf("reveal");
    if (predIdx >= 0 && revealIdx >= 0 && predIdx > revealIdx)
      errors.push("grammar: prediction must precede reveal (tap-gate would spoil, D-004)");

    const hypCount = beats.filter((b) => b === "hypothesis").length;
    if (hypCount < 2) warnings.push("long-form usually wants >=2 competing hypotheses");

    // monotonically non-decreasing story order (concept/cast intros float freely before investigation)
    let last = -1;
    beats.forEach((b, i) => {
      if (b === "concept-intro" || b === "cast-intro") return;
      const o = BEAT_ORDER[b]!;
      if (o < last) warnings.push(`panel[${i}]: beat '${b}' appears after a later-stage beat (check story order)`);
      last = Math.max(last, o);
    });
  }

  // --- quiz rules
  if (spec.narrative_density !== "map-update-only") {
    if (!spec.quiz?.length) errors.push("non-map-update episodes need a quiz");
    if ((spec.quiz?.length ?? 0) > 5) warnings.push("quiz > 5 items; Litt convention is 3-5");
    spec.quiz?.forEach((q, i) => validatePrediction(q, `quiz[${i}]`, errors, conceptIds));
  }

  // --- map updates always required (the accreting map is the semantic-memory half)
  if (!spec.map_updates?.length) errors.push("missing map_updates (every episode grows the map)");

  // --- definition-at-point-of-use: every concept MUST be term-linkable in the
  // narrative (else the reader who's never seen it gets NO footnote when the term
  // first appears — the whole point of the concept system). Mirrors the renderer's
  // termLink matcher (name + aliases + spaced id, len>=4, word-boundary) against
  // the concatenated panel bodies. If nothing matches, the concept needs an alias
  // that actually appears in the prose it explains.
  //
  // This is an ERROR (promoted from a warning once all committed specs passed):
  // a concept whose term never appears in any body silently drops its definition
  // tooltip, defeating the concept system. Extractor prompt rules 5a + 9 make new
  // extractions satisfy it; the extract pipeline's retry-with-feedback repairs a
  // first-pass miss. See references/slide-discipline.md § definition-at-point-of-use.
  const narrativeText = spec.panels
    .map((p) => `${p.body ?? ""} ${p.code?.caption ?? ""}`)
    .join(" ");
  spec.concepts.forEach((c) => {
    const surfaceForms = [c.name, ...(c.aliases ?? []), c.id.replace(/-/g, " ")]
      .filter((a) => a.length >= 4);
    const linkable = surfaceForms.some((form) => {
      const re = new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return re.test(narrativeText);
    });
    if (!linkable) {
      errors.push(
        `concept '${c.id}': no surface form (name/aliases/id) appears in any panel body — ` +
        `no definition tooltip will attach at point of first use. Add an \`aliases\` entry ` +
        `matching how the term is actually written in the prose (extractor rules 5a + 9)`,
      );
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

function validatePrediction(
  q: { question: string; options: { id: string; text: string }[]; answer: string; feedback: Record<string, string> },
  at: string,
  errors: string[],
  _conceptIds: Set<string>,
): void {
  if (!q.question) errors.push(`${at}: empty question`);
  if ((q.options?.length ?? 0) < 2) errors.push(`${at}: needs >=2 options`);
  const optIds = new Set(q.options.map((o) => o.id));
  if (!optIds.has(q.answer)) errors.push(`${at}: answer '${q.answer}' not among options`);
  optIds.forEach((id) => {
    if (!q.feedback?.[id]) errors.push(`${at}: option '${id}' missing feedback (hypercorrection needs per-option feedback)`);
  });
}

/** Guard the figure shape per type so a malformed figure fails validation (and the
 *  extractor's retry) instead of crashing the renderer. */
function validateFigure(f: Figure, at: string, errors: string[]): void {
  const need = (cond: boolean, msg: string) => { if (!cond) errors.push(`${at}: figure ${msg}`); };
  switch (f.type) {
    case "flow":
      need(Array.isArray(f.nodes) && f.nodes.length > 0, "flow needs nodes[]");
      need(Array.isArray(f.edges), "flow needs edges[]");
      break;
    case "sequence":
      need(Array.isArray(f.steps) && f.steps.length > 0, "sequence needs steps[]");
      break;
    case "compare":
      need(!!f.before?.items && !!f.after?.items, "compare needs before.items and after.items");
      break;
    case "scene": {
      need(Array.isArray(f.actors) && f.actors.length > 0, "scene needs actors[]");
      need(Array.isArray(f.steps) && f.steps.length > 0, "scene needs steps[]");
      const ids = new Set((f.actors ?? []).map((a) => a.id));
      const acts = new Set(["appear", "type", "move", "flow", "flash", "vanish"]);
      (f.steps ?? []).forEach((s, i) => {
        need(acts.has(s.action), `scene step[${i}] has unknown action '${s.action}'`);
        if (s.actor) need(ids.has(s.actor), `scene step[${i}] actor '${s.actor}' not in actors[]`);
        if (s.to) need(ids.has(s.to), `scene step[${i}] target '${s.to}' not in actors[]`);
        if (s.action === "move" || s.action === "flow")
          need(!!s.actor && !!s.to, `scene step[${i}] (${s.action}) needs actor and to`);
      });
      break;
    }
    case "architecture":
      need(Array.isArray(f.layers) && f.layers.length > 0, "architecture needs layers[]");
      need((f.layers ?? []).every((l) => Array.isArray(l.nodes) && l.nodes.length > 0), "architecture layers need nodes[]");
      break;
    default:
      errors.push(`${at}: unknown figure type '${(f as { type?: string }).type}'`);
  }
}
