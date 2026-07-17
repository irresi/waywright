/**
 * core/learner.ts — the learner model (Layer C, D-005).
 *
 * Surface-independent JSON store: the browser writes exposure/answers to
 * localStorage; the server/CLI persists to ~/.human-mem/learner.json. This is
 * the accreting, defensible asset (D-012) — deliberately NOT caged in any editor.
 *
 * v1 is an EXPOSURE ledger, not a knowledge estimator (D-005): we track what
 * we've SHOWN, plus quiz answers for later knowledge tracing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { LearnerModel, EpisodeSpec } from "./types";

export function defaultLearnerPath(): string {
  return join(homedir(), ".human-mem", "learner.json");
}

export function loadLearner(path = defaultLearnerPath()): LearnerModel {
  if (!existsSync(path)) return { concepts: {}, answers: {}, asked_about: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LearnerModel;
  } catch {
    return { concepts: {}, answers: {}, asked_about: [] };
  }
}

export function saveLearner(lm: LearnerModel, path = defaultLearnerPath()): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(lm, null, 2));
}

/**
 * Record that an episode's concepts were shown, mutating the ledger. The browser
 * does the same client-side; this server-side path keeps the canonical file in
 * sync when episodes are pre-rendered or when quiz answers post back.
 */
export function recordExposure(lm: LearnerModel, spec: EpisodeSpec): LearnerModel {
  for (const c of spec.concepts) {
    const entry = (lm.concepts[c.id] ??= { shown: 0 });
    entry.shown += 1;
    entry.last_seen = spec.id;
    entry.last_depth = entry.shown >= 3 ? "one_liner" : "full";
  }
  return lm;
}

/** Ingest quiz/gate answers posted back from the viewer (knowledge tracing seed). */
export function recordAnswers(
  lm: LearnerModel,
  answers: LearnerModel["answers"],
): LearnerModel {
  lm.answers = { ...lm.answers, ...answers };
  for (const a of Object.values(answers)) {
    if (a.correct === false && a.concepts) {
      lm.asked_about = Array.from(new Set([...(lm.asked_about ?? []), ...a.concepts]));
    }
  }
  return lm;
}

/**
 * Prediction-accuracy metric (D-003): the retention-critical number.
 * Fraction of answered quiz/gate items that were correct.
 */
export function predictionAccuracy(lm: LearnerModel): { correct: number; answered: number; rate: number } {
  const graded = Object.values(lm.answers).filter((a) => typeof a.correct === "boolean");
  const correct = graded.filter((a) => a.correct).length;
  const answered = graded.length;
  return { correct, answered, rate: answered ? correct / answered : 0 };
}
