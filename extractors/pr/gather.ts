/**
 * extractors/pr/gather.ts — deterministic PR data collection via the `gh` CLI.
 *
 * No LLM here: just structured facts the extractor prompt will turn into an
 * episode spec. Keeping this separate means the (expensive, non-deterministic)
 * Claude step gets a clean, complete, auditable input — and every fact in the
 * final episode is traceable to something gathered here (no fabrication).
 */
import { $ } from "bun";

export interface GatheredPR {
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  mergedAt: string | null;
  state: string;
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  comments: { author: string; body: string }[];
  reviews: { author: string; state: string; body: string }[];
  linkedIssues: { number: number; title: string; body: string }[];
  relatedPRs: { number: number; title: string; author: string; state: string }[];
  diffExcerpt: string;
}

/** Pull issue/PR numbers referenced in text (Closes #123, Supersedes #45, etc.). */
function refNumbers(text: string): number[] {
  const out = new Set<number>();
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(Number(m[1]));
  return Array.from(out);
}

async function ghJson<T>(args: string[]): Promise<T> {
  const res = await $`gh ${args}`.quiet();
  return JSON.parse(res.stdout.toString()) as T;
}

export async function gatherPR(repo: string, number: number): Promise<GatheredPR> {
  const pr = await ghJson<any>([
    "pr", "view", String(number), "--repo", repo, "--json",
    "title,body,author,mergedAt,state,additions,deletions,files,comments,reviews",
  ]);

  // linked issues + superseded/related PRs from the body text
  const refs = refNumbers(pr.body ?? "");
  const linkedIssues: GatheredPR["linkedIssues"] = [];
  const relatedPRs: GatheredPR["relatedPRs"] = [];
  for (const n of refs) {
    if (n === number) continue;
    // GitHub's issue API also returns PRs (a PR *is* an issue), so we must
    // disambiguate: fetch as issue, then check whether it's actually a PR.
    try {
      const issue = await ghJson<any>(["issue", "view", String(n), "--repo", repo, "--json", "title,body,url"]);
      const isPR = typeof issue.url === "string" && issue.url.includes("/pull/");
      if (isPR) {
        const rp = await ghJson<any>(["pr", "view", String(n), "--repo", repo, "--json", "title,author,state"]);
        relatedPRs.push({ number: n, title: rp.title, author: rp.author?.login ?? "?", state: rp.state });
      } else {
        linkedIssues.push({ number: n, title: issue.title, body: (issue.body ?? "").slice(0, 1500) });
      }
    } catch {
      // fall back: try as PR directly
      try {
        const rp = await ghJson<any>(["pr", "view", String(n), "--repo", repo, "--json", "title,author,state"]);
        relatedPRs.push({ number: n, title: rp.title, author: rp.author?.login ?? "?", state: rp.state });
      } catch { /* dangling ref; skip */ }
    }
  }

  // a bounded diff excerpt (full diffs blow the context budget; the extractor
  // gets file-level stats always, plus a capped unified-diff sample)
  let diffExcerpt = "";
  try {
    const diff = await $`gh pr diff ${String(number)} --repo ${repo}`.quiet();
    diffExcerpt = diff.stdout.toString().slice(0, 12000);
  } catch { /* diff may be unavailable on some PRs */ }

  return {
    repo,
    number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.author?.login ?? "?",
    mergedAt: pr.mergedAt ?? null,
    state: pr.state,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    files: (pr.files ?? []).map((f: any) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    comments: (pr.comments ?? []).map((c: any) => ({ author: c.author?.login ?? "?", body: (c.body ?? "").slice(0, 1200) })),
    reviews: (pr.reviews ?? []).map((r: any) => ({ author: r.author?.login ?? "?", state: r.state, body: (r.body ?? "").slice(0, 1200) })),
    linkedIssues,
    relatedPRs,
    diffExcerpt,
  };
}

/**
 * Cheap narrative-density heuristic (Q-4 owns the real classifier).
 * Signals: competing PRs, review discussion volume, linked issues, diff size.
 */
export function gradeDensity(pr: GatheredPR): "long-form" | "four-panel" | "map-update-only" {
  const discussion = pr.comments.length + pr.reviews.filter((r) => r.body).length;
  const hasCompeting = pr.relatedPRs.length > 0;
  const hasStory = pr.linkedIssues.length > 0;
  const churn = pr.additions + pr.deletions;

  if ((hasCompeting && hasStory) || (discussion >= 4 && churn >= 100)) return "long-form";
  if (discussion >= 1 || hasStory || churn >= 40) return "four-panel";
  return "map-update-only";
}
