/**
 * core/types.ts — Episode Spec v0.1 types.
 * Mirror of spec/episode-spec.schema.json. The spec is the load-bearing artifact
 * (decision D-009): extractors produce it, renderers consume it, the learner
 * model personalizes at render time.
 */

export type SourceKind = "pr" | "session" | "issue" | "commit-range";
export type NarrativeDensity = "long-form" | "four-panel" | "map-update-only";
export type Beat =
  | "cold-open"
  | "incident"
  | "cast-intro"
  | "concept-intro"
  | "investigation"
  | "hypothesis"
  | "prediction"
  | "reveal"
  | "code-walk"
  | "resolution"
  | "ratification"
  | "teaser";

export interface EpisodeSource {
  kind: SourceKind;
  repo?: string;
  pr_number?: number;
  issue_numbers?: number[];
  related_prs?: number[];
  session_id?: string;
  merged_at?: string;
  urls?: string[];
}

export interface ConceptIntro {
  one_liner: string;
  full: string;
}

export interface Concept {
  id: string;
  name: string;
  intro: ConceptIntro;
  area?: string;
  /** surface forms to term-link in panel bodies (defaults: name + id with spaces) */
  aliases?: string[];
}

export interface CastMember {
  id: string;
  label: string;
  role: string;
}

export interface PredictionOption {
  id: string;
  text: string;
  maps_to_hypothesis?: string;
}

export interface Prediction {
  question: string;
  options: PredictionOption[];
  answer: string;
  feedback: Record<string, string>;
  concept_ids?: string[];
}

export interface CodeExhibit {
  lang?: string;
  snippet: string;
  file?: string;
  caption?: string;
}

/**
 * Intuition figure (dual coding, Paivio; D-004 seductive-details rule).
 * The model emits STRUCTURED DATA, never raw SVG — the renderer draws it, so
 * text can't garble and every figure carries causal structure, not decoration.
 *
 * - flow: nodes + directed edges. A drifting/error edge is dashed+red.
 *   Use for "message goes A -> B but drifts to X".
 * - sequence: ordered events on a timeline; `fault` marks where it breaks.
 *   Use for "typed -> debounce wait -> session switch -> wrong save".
 * - compare: before vs after, each a short bullet list.
 *   Use for "N fetches per instance" vs "1 shared fetch".
 * - scene: an ANIMATIC. Actors (positioned boxes) + ordered steps that play out
 *   the specific incident so a human SEES it happen — e.g. Session A appears,
 *   Session B appears, text is typed into B, then mis-files into A (a fault flow).
 *   Use on cold-open/incident to dramatize the bug, not describe it.
 */
export type Figure =
  | { type: "flow"; caption?: string; nodes: { id: string; label: string }[];
      edges: { from: string; to: string; label?: string; kind?: "normal" | "fault" }[] }
  | { type: "sequence"; caption?: string; steps: { label: string; fault?: boolean }[] }
  | { type: "compare"; caption?: string; before: { title: string; items: string[] };
      after: { title: string; items: string[] } }
  | { type: "scene"; caption?: string;
      /** actors placed on a 0..100 × 0..100 stage (renderer scales to pixels). */
      actors: {
        id: string; label: string; x: number; y: number;
        kind?: "frontend" | "backend" | "database" | "cloud" | "security" | "bus" | "external";
      }[];
      /** ordered animation beats; each plays for one tick, with an optional caption. */
      steps: {
        action: "appear" | "type" | "move" | "flow" | "flash" | "vanish";
        actor?: string;      // subject of the beat (appear/type/flash/vanish; source of move/flow)
        to?: string;         // target actor for move/flow
        text?: string;       // token text for type/move (e.g. the message being written)
        label?: string;      // edge label for flow
        fault?: boolean;     // this beat is the bug (red/dashed) — the moment it goes wrong
        note?: string;       // one-line caption shown while this beat plays
      }[]; }
  | { type: "architecture"; caption?: string;
      /** components grouped into horizontal layers (top -> bottom). `kind` picks a
       *  semantic color; `touched` highlights what this change modified. */
      layers: {
        label?: string;
        nodes: {
          id: string; label: string; sub?: string;
          kind?: "frontend" | "backend" | "database" | "cloud" | "security" | "bus" | "external";
          touched?: boolean;
        }[];
      }[];
      edges?: { from: string; to: string; label?: string; kind?: "normal" | "fault" }[] };

export interface Panel {
  beat: Beat;
  speaker?: string;
  concept_ref?: string;
  hypothesis_id?: string;
  body: string;
  figure?: Figure;
  code?: CodeExhibit;
  prediction?: Prediction;
}

export interface Decision {
  chose: string;
  over: string;
  because: string;
}

export interface MapUpdate {
  area: string;
  note: string;
}

export interface EpisodeSpec {
  spec_version: "0.1";
  id: string;
  source: EpisodeSource;
  narrative_density: NarrativeDensity;
  title: string;
  logline?: string;
  concepts: Concept[];
  cast?: CastMember[];
  panels: Panel[];
  decisions?: Decision[];
  boundaries?: string[];
  quiz: Prediction[];
  map_updates: MapUpdate[];
  teaser?: string;
}

/** Learner model (Layer C): exposure ledger, D-005. Surface-independent. */
export interface ConceptExposure {
  shown: number;
  last_depth?: "full" | "one_liner" | "hidden";
  last_seen?: string; // episode id
}

export interface LearnerModel {
  concepts: Record<string, ConceptExposure>;
  answers: Record<
    string,
    { picked: string; correct?: boolean; concepts?: string[]; at?: string }
  >;
  asked_about?: string[];
}
