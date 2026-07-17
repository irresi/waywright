/**
 * slopscan.ts — a deterministic AI-slop detector for episode prose.
 *
 * Scans a spec's human-facing text (panel bodies, figure captions, scene-step
 * notes, concept intros, quiz stems) for the structural + phrasal tells that make
 * writing read as machine-generated. Catalog distilled from:
 *   - hardikpandya/stop-slop  (structures.md + phrases.md)
 *   - Wikipedia "Signs of AI writing" (via blader/humanizer): -ing analyses,
 *     rule of three, negative parallelisms, inflated significance.
 *
 * Tuned for THIS domain (technical PR walkthroughs), so a few of stop-slop's
 * blanket bans are deliberately NOT enforced: we allow -ly adverbs and wh- clause
 * openers where they carry real meaning; we flag only the patterns that are slop
 * regardless of domain. Findings are advisory (severity high|med|low), not hard
 * errors — the point is a report the author acts on, not a build gate.
 */

export type SlopHit = {
  category: string;
  severity: "high" | "med" | "low";
  match: string;
  where: string; // panel id / field
  hint: string;
};

type Rule = {
  category: string;
  severity: "high" | "med" | "low";
  re: RegExp;
  hint: string;
};

// Each rule is a global, case-insensitive regex over a single text field.
const RULES: Rule[] = [
  // ── Meta-narration / "we follow / let's look at" tour-guide voice ──────────
  {
    category: "meta-narration",
    severity: "high",
    // require the apostrophe on we'll / let's so bare "well" / "lets" don't false-positive
    re: /\b(let[’']s|we[’']ll|we will|we[’']re going to|in this (section|episode|walkthrough)|let me (walk|show|explain)|as we[’']ll see|we[’']ll (see|explore|look|follow|trace|dig|dive))\b/gi,
    hint: "Drop the tour-guide framing; state the thing directly (no 'we'll look at…').",
  },
  {
    // English -ing tour verbs AND the Korean equivalents the user called out.
    category: "superficial-ing / narration verb",
    severity: "med",
    re: /\b(diving into|digging into|delving into|taking a (look|closer look)|walking through|stepping through|unpacking|exploring how|examining how)\b/gi,
    hint: "Superficial '-ing' analysis verb — replace with the concrete claim.",
  },
  {
    // Korean narration slop the user flagged: 따라갑니다 / 살펴봅니다 / 알아봅니다 …
    category: "meta-narration (KO)",
    severity: "high",
    re: /(따라갑니다|따라가 ?봅니다|살펴봅니다|살펴 ?보겠습니다|알아봅니다|알아 ?보겠습니다|들여다봅니다|짚어봅니다|파헤쳐 ?봅니다|한번 ?보겠습니다)/g,
    hint: "한국어 투어-내레이션 — 대상을 바로 서술하세요(‘살펴봅니다/따라갑니다’ 금지).",
  },
  // ── Throat-clearing openers ────────────────────────────────────────────────
  {
    category: "throat-clearing opener",
    severity: "high",
    re: /(^|[.!?]\s+)(here'?s (the thing|what|why|the problem|how)|the (uncomfortable )?truth is|it turns out|let me be clear|make no mistake|the real \w+ is)\b/gi,
    hint: "Cut the announcement; open on the point itself.",
  },
  // ── Binary contrast / false-drama reversal ────────────────────────────────
  {
    category: "binary contrast",
    severity: "high",
    re: /\b(it'?s not (just )?(about )?\w[\w\s]{0,30}?[,.] it'?s|not because \w[\w\s]{0,30}? but because|the (answer|question|problem) (isn'?t|is not) \w[\w\s]{0,30}? it'?s|isn'?t \w[\w\s]{0,20}?[,.]? it'?s)\b/gi,
    hint: "Telegraphed reversal — state the positive claim directly, drop the negation.",
  },
  {
    category: "negative parallelism",
    severity: "med",
    re: /\bnot (just|only) \w[\w\s]{0,30}? but( also)?\b/gi,
    hint: "Additive hedge ('not just X but Y') — say what it IS.",
  },
  // ── Rule of three (inflated triple parallel) ──────────────────────────────
  {
    category: "rule-of-three",
    severity: "low",
    re: /\b(\w+), (\w+),? and (\w+)[.,]/g, // heuristic; author confirms if it's puffery
    hint: "Possible inflated triple — keep only if all three items carry weight.",
  },
  // ── Inflated significance / vague declaratives ────────────────────────────
  {
    category: "inflated significance",
    severity: "med",
    re: /\b(the (implications|stakes|consequences) (are|were) (significant|high|real|profound)|this (is|matters) (deeply|fundamentally|profoundly)|a game[- ]changer|paradigm shift|at its core|at the end of the day)\b/gi,
    hint: "Announcing importance without the specific thing — show it or cut it.",
  },
  // ── False agency (inanimate things doing human verbs) ─────────────────────
  {
    category: "false agency",
    severity: "low",
    re: /\b(the (data|code|test|diff|system|market|design) (tells|wants|decides|knows|rewards|punishes)|a (bug|complaint|bet) (becomes|lives|dies|emerges))\b/gi,
    hint: "Name the human/actor instead of giving the artifact human verbs.",
  },
  // ── Emphasis crutches / filler ────────────────────────────────────────────
  {
    category: "emphasis crutch / filler",
    severity: "med",
    re: /\b(it'?s worth noting|it should be noted|needless to say|as you (can|might) (see|expect)|of course|clearly,|obviously,|simply put|in essence)\b/gi,
    hint: "Empty emphasis — delete; let the content carry weight.",
  },
  // ── Em dash overuse (flag; our house style prefers commas/periods) ────────
  {
    category: "em-dash",
    severity: "low",
    re: /—/g,
    hint: "Em-dash — fine in moderation, but 2+ per short body reads as AI. Prefer commas/periods.",
  },
];

// em-dash is only slop when repeated within one field; handled specially below.

const FIELD_DASH_THRESHOLD = 2;

function scanField(text: string, where: string): SlopHit[] {
  if (!text) return [];
  const hits: SlopHit[] = [];
  for (const rule of RULES) {
    if (rule.category === "em-dash") continue; // special-cased
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      hits.push({
        category: rule.category,
        severity: rule.severity,
        match: m[0].trim().slice(0, 80),
        where,
        hint: rule.hint,
      });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // avoid zero-width loop
    }
  }
  // em-dash: only flag when a single field carries >= threshold
  const dashes = (text.match(/—/g) || []).length;
  if (dashes >= FIELD_DASH_THRESHOLD) {
    hits.push({
      category: "em-dash",
      severity: "low",
      match: `${dashes} em-dashes in one field`,
      where,
      hint: "2+ em-dashes in one passage reads as AI; prefer commas/periods.",
    });
  }
  return hits;
}

/** Scan a full episode spec and return every slop finding, grouped by field. */
export function scanSpec(spec: {
  title?: string;
  logline?: string;
  panels?: Array<{
    beat?: string;
    body?: string;
    code?: { caption?: string };
    figure?: { caption?: string; steps?: Array<{ note?: string }> };
    prediction?: { question?: string };
  }>;
  quiz?: Array<{ question?: string }>;
  concepts?: Array<{ id?: string; intro?: { full?: string; one_liner?: string } }>;
}): SlopHit[] {
  const hits: SlopHit[] = [];
  if (spec.title) hits.push(...scanField(spec.title, "title"));
  if (spec.logline) hits.push(...scanField(spec.logline, "logline"));
  spec.panels?.forEach((p, i) => {
    const where = `panel[${i}]:${p.beat ?? "?"}`;
    hits.push(...scanField(p.body ?? "", `${where}/body`));
    hits.push(...scanField(p.code?.caption ?? "", `${where}/code.caption`));
    hits.push(...scanField(p.figure?.caption ?? "", `${where}/figure.caption`));
    hits.push(...scanField(p.prediction?.question ?? "", `${where}/prediction.q`));
    for (const s of p.figure?.steps ?? []) {
      hits.push(...scanField(s.note ?? "", `${where}/figstep.note`));
    }
  });
  spec.quiz?.forEach((q, i) => {
    hits.push(...scanField(q.question ?? "", `quiz[${i}].question`));
  });
  for (const c of spec.concepts ?? []) {
    const where = `concept:${c.id ?? "?"}`;
    hits.push(...scanField(c.intro?.full ?? "", `${where}/intro.full`));
    hits.push(...scanField(c.intro?.one_liner ?? "", `${where}/intro.one_liner`));
  }
  return hits;
}

/** Console-friendly summary. */
export function formatReport(specName: string, hits: SlopHit[]): string {
  if (!hits.length) return `✓ ${specName}: no slop patterns found`;
  const bySev = { high: 0, med: 0, low: 0 } as Record<string, number>;
  for (const h of hits) bySev[h.severity]!++;
  const lines = [`⚠ ${specName}: ${hits.length} hits (high:${bySev.high} med:${bySev.med} low:${bySev.low})`];
  for (const h of hits) {
    const tag = h.severity === "high" ? "🔴" : h.severity === "med" ? "🟡" : "⚪";
    lines.push(`  ${tag} [${h.category}] ${h.where}\n      “${h.match}” — ${h.hint}`);
  }
  return lines.join("\n");
}
