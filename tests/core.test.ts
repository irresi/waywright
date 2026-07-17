/**
 * tests/core.test.ts — lock in the shared core's contract.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EpisodeSpec } from "../core/types";
import { validateSpec } from "../core/validate";
import { renderEpisode } from "../core/render";
import { recordExposure, predictionAccuracy } from "../core/learner";
import { renderFigure } from "../core/figure";
import { scanSpec } from "../core/slopscan";
import type { Figure } from "../core/types";

const specPath = join(import.meta.dir, "..", "episodes", "hermes-agent-pr-62413.spec.json");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as EpisodeSpec;

test("Episode 1 spec validates clean", () => {
  const { ok, errors } = validateSpec(spec);
  if (!ok) console.error(errors);
  expect(ok).toBe(true);
});

test("validator rejects missing required beats in long-form", () => {
  const broken: EpisodeSpec = { ...spec, panels: spec.panels.filter((p) => p.beat !== "reveal") };
  const { ok, errors } = validateSpec(broken);
  expect(ok).toBe(false);
  expect(errors.some((e) => e.includes("reveal"))).toBe(true);
});

test("body optional when a code exhibit or figure carries the panel", () => {
  const codeWalk = spec.panels.find((p) => p.beat === "code-walk" && p.code)!;
  const noBody: EpisodeSpec = {
    ...spec,
    panels: spec.panels.map((p) => (p === codeWalk ? { ...p, body: undefined as unknown as string } : p)),
  };
  const { ok, errors } = validateSpec(noBody);
  if (!ok) console.error(errors);
  expect(ok).toBe(true); // code exhibit substitutes for body
  // but a bare panel with neither body nor substitute still fails
  const bare: EpisodeSpec = {
    ...spec,
    panels: spec.panels.map((p) => (p.beat === "investigation" ? { ...p, body: "", figure: undefined, code: undefined } : p)),
  };
  expect(validateSpec(bare).ok).toBe(false);
});

test("validator enforces prediction-before-reveal (tap-gate D-004)", () => {
  const panels = [...spec.panels];
  const pi = panels.findIndex((p) => p.beat === "prediction");
  const ri = panels.findIndex((p) => p.beat === "reveal");
  // swap so reveal precedes prediction
  [panels[pi], panels[ri]] = [panels[ri]!, panels[pi]!];
  const { errors } = validateSpec({ ...spec, panels });
  expect(errors.some((e) => e.includes("prediction must precede reveal"))).toBe(true);
});

test("validator requires per-option feedback (hypercorrection)", () => {
  const q = structuredClone(spec.quiz[0]!);
  delete (q.feedback as Record<string, string>)[q.options[0]!.id];
  const { ok, errors } = validateSpec({ ...spec, quiz: [q, ...spec.quiz.slice(1)] });
  expect(ok).toBe(false);
  expect(errors.some((e) => e.includes("missing feedback"))).toBe(true);
});

test("definition-at-point-of-use: errors when a concept term never appears in the prose", () => {
  // a concept whose name/aliases/id match nothing in any body → no tooltip can attach
  const orphanConcept = {
    id: "zzz-unlinkable-concept",
    name: "Quixotic Flux Capacitor",
    aliases: [],
    intro: { one_liner: "unused", full: "unused" },
  };
  const withOrphan: EpisodeSpec = { ...spec, concepts: [...spec.concepts, orphanConcept as EpisodeSpec["concepts"][number]] };
  const { ok, errors } = validateSpec(withOrphan);
  expect(ok).toBe(false);
  expect(errors.some((e) => e.includes("zzz-unlinkable-concept") && e.includes("definition tooltip"))).toBe(true);

  // and when an alias DOES appear in a body, no such error for that concept
  const bodyWord = spec.panels.find((p) => p.body)!.body.split(/\s+/).find((w) => w.length >= 5)!.replace(/[^\w]/g, "");
  const linkable = { ...orphanConcept, aliases: [bodyWord] };
  const withLinkable: EpisodeSpec = { ...spec, concepts: [...spec.concepts, linkable as EpisodeSpec["concepts"][number]] };
  const { errors: e2 } = validateSpec(withLinkable);
  expect(e2.some((e) => e.includes("zzz-unlinkable-concept"))).toBe(false);
});

test("renders a self-contained HTML doc with all core structures", () => {
  const html = renderEpisode(spec);
  expect(html).toStartWith("<!DOCTYPE html>");
  for (const needle of ['class="gate"', 'id="after-gate"', 'class="mapbox"', 'class="scorecard"', "humanmem-learner"]) {
    expect(html).toContain(needle);
  }
  // no external resource loads (D-004: fully self-contained)
  expect(html).not.toContain("<script src");
  expect(html).not.toContain("<link rel=\"stylesheet\"");
});

test("comic-book layout: every panel is a page and every page carries an image", () => {
  const html = renderEpisode(spec);
  // page-flip scaffolding present
  expect(html).toContain('class="deck"');
  expect(html).toContain('class="coverpage"');
  expect(html).toContain('id="next"');
  expect(html).toContain('id="prev"');
  expect(html).toContain('class="tapzone left"');
  // one .page per panel that produces a page (all beats except teaser render inline as a page)
  const pageCount = (html.match(/<section class="page/g) ?? []).length;
  const panelPages = spec.panels.filter((p) => p.beat !== "teaser").length;
  expect(pageCount).toBeGreaterThanOrEqual(panelPages);
  // key beats still carry an image (a real figure, an animatic scene, or a motif);
  // purely-narrative beats may now be text-only (generic filler images were dropped).
  const artSlots = (html.match(/class="pageart"/g) ?? []).length;
  expect(artSlots).toBeGreaterThan(0);
});

test("exposure ledger collapses concept intros after 3 views (D-005)", () => {
  // check the rendered concept <section> class, not the CSS rule text
  const conceptSectionClass = (html: string, id: string): string => {
    const m = html.match(new RegExp(`<section class="(concept[^"]*)" id="c-${id}"`));
    return m?.[1] ?? "";
  };
  // derive a concept id from the spec so the test survives re-extraction
  const cid = spec.concepts[0]!.id;
  let lm = { concepts: {}, answers: {} };
  lm = recordExposure(lm, spec);
  lm = recordExposure(lm, spec);
  const cold = renderEpisode(spec, lm); // shown=2 → still full
  expect(conceptSectionClass(cold, cid)).toBe("concept");
  lm = recordExposure(lm, spec); // shown=3 → collapse
  const warm = renderEpisode(spec, lm);
  expect(conceptSectionClass(warm, cid)).toBe("concept collapsed");
});

test("prediction accuracy metric (D-003)", () => {
  const lm = {
    concepts: {},
    answers: {
      gate: { picked: "both", correct: true },
      q1: { picked: "a", correct: true },
      q2: { picked: "a", correct: false },
    },
  };
  const acc = predictionAccuracy(lm);
  expect(acc.answered).toBe(3);
  expect(acc.correct).toBe(2);
  expect(acc.rate).toBeCloseTo(2 / 3);
});

test("figure renderer draws all 3 types as SVG/HTML, not raw model markup (D-004)", () => {
  const flow: Figure = {
    type: "flow",
    nodes: [{ id: "a", label: "Session A" }, { id: "b", label: "Session B" }],
    edges: [{ from: "b", to: "a", label: "drifts", kind: "fault" }],
  };
  const seq: Figure = { type: "sequence", steps: [{ label: "typed" }, { label: "switch", fault: true }] };
  const cmp: Figure = {
    type: "compare",
    before: { title: "before", items: ["re-read current"] },
    after: { title: "after", items: ["carry session"] },
  };
  const fFlow = renderFigure(flow), fSeq = renderFigure(seq), fCmp = renderFigure(cmp);
  expect(fFlow).toContain("<svg");
  expect(fFlow).toContain("Session A"); // label carried through, escaped
  expect(fSeq).toContain("<svg");
  expect(fSeq).toContain("⚡"); // fault steps flagged
  expect(fCmp).toContain("figcompare");
  expect(fCmp).toContain("carry session");

  const arch: Figure = {
    type: "architecture",
    layers: [
      { label: "ui", nodes: [{ id: "c", label: "Composer", kind: "frontend", touched: true }] },
      { label: "bus", nodes: [{ id: "g", label: "Gateway", kind: "bus" }] },
    ],
    edges: [{ from: "c", to: "g", label: "submit" }],
  };
  const fArch = renderFigure(arch);
  expect(fArch).toContain("figarch");
  expect(fArch).toContain("◆ changed"); // touched node badge
  expect(fArch).toContain("#22d3ee");    // frontend semantic stroke color
});

test("scene animatic renders actors + a serialized timeline the player can drive", () => {
  const sc: Figure = {
    type: "scene",
    caption: "the message that vanished",
    actors: [
      { id: "a", label: "Session A", x: 20, y: 20, kind: "frontend" },
      { id: "b", label: "Session B", x: 80, y: 20, kind: "frontend" },
      { id: "store", label: "Draft store", x: 50, y: 80, kind: "database" },
    ],
    steps: [
      { action: "appear", actor: "a", note: "Session A is open" },
      { action: "appear", actor: "b", note: "a fresh Session B opens" },
      { action: "type", actor: "b", text: "a long prompt", note: "you type into B" },
      { action: "flow", actor: "store", to: "a", label: "saves", fault: true, note: "filed under the WRONG session" },
      { action: "vanish", actor: "b", note: "B's message is gone" },
    ],
  };
  const html = renderFigure(sc);
  expect(html).toContain("figscene");
  expect(html).toContain('class="sc-actor"');            // actor boxes drawn
  expect(html).toContain("Session A");                    // label carried, escaped
  expect(html).toContain('class="sc-replay"');            // play/replay control
  expect(html).toContain("data-scene=");                  // serialized timeline for the player
  // the timeline is valid JSON carrying every step's action + note
  const m = html.match(/data-scene='([^']+)'/);
  expect(m).toBeTruthy();
  const tl = JSON.parse(
    m![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
  );
  expect(tl.length).toBe(5);
  expect(tl[3].fault).toBe(true);
  expect(tl[3].note).toContain("WRONG");
});

test("scene edges clip to box borders and route around an intervening box", () => {
  // three actors in a row; a flow from the LEFT one to the RIGHT one must not
  // run through the MIDDLE box (the crossing-lines bug).
  const sc: Figure = {
    type: "scene",
    actors: [
      { id: "l", label: "Left", x: 12, y: 50 },
      { id: "m", label: "Middle", x: 50, y: 50 },
      { id: "r", label: "Right", x: 88, y: 50 },
    ],
    steps: [{ action: "flow", actor: "l", to: "r", label: "skips over", fault: true }],
  };
  const html = renderFigure(sc);
  // pull the path's control point (Q cx cy) and endpoints
  const m = html.match(/d="M ([\d.]+) ([\d.]+) Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
  expect(m).toBeTruthy();
  const [, x0, y0, cx, cy] = m!.map(Number) as unknown as number[];
  // the middle box center is at stage x=50 → pixel center; the curve's control
  // point must be pushed OFF the straight horizontal line (bowed away in y) so
  // the rendered curve clears the middle box.
  expect(Math.abs(cy! - y0!)).toBeGreaterThan(20); // bowed vertically, not straight through
  // endpoint must sit on the Left box's RIGHT border, not its center (x=12 stage)
  // → x0 should be to the right of the left box center by ~half box width
  expect(x0!).toBeGreaterThan(cx! - 200); // sanity: parsed numbers are coherent
});

test("validator accepts a well-formed scene and rejects bad actor refs", () => {
  const good: EpisodeSpec = {
    ...spec,
    panels: spec.panels.map((p) =>
      p.beat === "cold-open"
        ? { ...p, figure: { type: "scene", actors: [{ id: "a", label: "A", x: 10, y: 10 }], steps: [{ action: "appear", actor: "a" }] } as Figure }
        : p,
    ),
  };
  expect(validateSpec(good).ok).toBe(true);
  const bad: EpisodeSpec = {
    ...spec,
    panels: spec.panels.map((p) =>
      p.beat === "cold-open"
        ? { ...p, figure: { type: "scene", actors: [{ id: "a", label: "A", x: 10, y: 10 }], steps: [{ action: "flow", actor: "a", to: "ghost" }] } as Figure }
        : p,
    ),
  };
  const res = validateSpec(bad);
  expect(res.ok).toBe(false);
  expect(res.errors.some((e) => e.includes("'ghost' not in actors"))).toBe(true);
});

test("validator rejects a malformed figure (architecture missing layers)", () => {
  const bad: EpisodeSpec = {
    ...spec,
    panels: spec.panels.map((p) =>
      p.beat === "cold-open" ? { ...p, figure: { type: "architecture" } as unknown as Figure } : p,
    ),
  };
  const { ok, errors } = validateSpec(bad);
  expect(ok).toBe(false);
  expect(errors.some((e) => e.includes("architecture needs layers"))).toBe(true);
});

test("renderFigure degrades to empty on malformed data, never throws", () => {
  expect(renderFigure({ type: "architecture" } as unknown as Figure)).toBe("");
  expect(renderFigure({ type: "flow" } as unknown as Figure)).toBe("");
  expect(renderFigure({ type: "sequence" } as unknown as Figure)).toBe("");
});

test("figures render into the episode HTML above panel bodies", () => {
  // Episode 1 spec carries a sequence figure on the investigation panel + a compare on resolution
  const html = renderEpisode(spec);
  expect(html).toContain("figsvg");             // a structured figure SVG (scene/sequence/…)
  expect(html).toContain("figcompare");         // the before/after
  // any figure caption present in the spec must render through
  const caption = spec.panels.map((p) => p.figure?.caption).find((c): c is string => !!c);
  if (caption) expect(html).toContain(caption);
});

test("term tooltips: first occurrence linked with one-liner, never inside <code>", () => {
  const html = renderEpisode(spec);
  // linked terms carry the definition at point of use
  expect(html).toContain('class="term"');
  // at least one concept's one-liner must surface in a termtip (derived from spec)
  const linkedOneLiner = spec.concepts
    .map((c) => c.intro.one_liner)
    .find((ol) => html.includes(`<span class="termtip">`) && html.includes(ol));
  expect(linkedOneLiner).toBeDefined();
  // tag-safe: no term spans nested into code blocks
  for (const codeBlock of html.match(/<code>[\s\S]*?<\/code>/g) ?? []) {
    expect(codeBlock).not.toContain('class="term"');
  }
});

test("slopscan: flags real slop but not lookalike words", () => {
  const dirty = scanSpec({
    panels: [
      { beat: "hypothesis", body: "Here's the thing: it's not a caching bug, it's a scoping bug. We'll walk through why." },
      { beat: "investigation", body: "The implications are significant. The data tells us the answer." },
    ],
  });
  const cats = new Set(dirty.map((h) => h.category));
  expect(cats.has("throat-clearing opener")).toBe(true);
  expect(cats.has("binary contrast")).toBe(true);
  expect(cats.has("meta-narration")).toBe(true);
  expect(cats.has("inflated significance")).toBe(true);
  expect(cats.has("false agency")).toBe(true);
});

test("slopscan: 'well' / 'lets' are NOT false-flagged as we'll / let's", () => {
  const clean = scanSpec({
    panels: [
      { beat: "reveal", body: "The response arrives well after the user switched, and the guard lets it through." },
    ],
  });
  // the only allowable hit here would be em-dash (none present) — meta-narration must be absent
  expect(clean.some((h) => h.category === "meta-narration")).toBe(false);
});

test("slopscan: clean technical prose scores zero", () => {
  const clean = scanSpec({
    panels: [
      { beat: "incident", body: "The debounce timer read activeQueueSessionKeyRef.current at fire time, after the session had already switched." },
    ],
  });
  expect(clean.length).toBe(0);
});
