// Parallel 3-probe orchestrator. One vague goal ("find bugs in openclaw") fans
// out to three independent judges that write into ONE shared record:
//   • zero   — buys a static-analysis capability off the Zero market (real x402 pay)
//              and lints real target source with it.
//   • steal  — mines design decisions from a reference repo (hermes-agent).
//   • local  — Claude reads the target code and proposes candidate bugs.
// They run concurrently, then merge. The shared record IS the demo: three
// judges, one memory. Written to .ouroboros/probes.json for the live dashboard.
import { spawnSync } from "bun";
import { ask } from "./claude";
import { cloneReference, mineDecisions } from "./steal";
import type { StolenDecision } from "./types";

const TARGET = process.env.PROBE_TARGET_DIR ?? process.env.TARGET_DIR ?? ".";
const STEAL_FROM = process.env.PROBE_STEAL_REPO ?? "irresi/hermes-agent";
const MAX_PAY = process.env.PROBE_MAX_PAY ?? "0.05"; // USDC per call ceiling
const OUT = process.env.PROBE_OUT ?? ".ouroboros/probes.json";

export type ProbeName = "zero" | "steal" | "local";
export interface ProbeResult {
  probe: ProbeName;
  status: "running" | "ok" | "empty" | "error";
  headline: string;              // one-line for the dashboard
  detail?: string;               // richer body
  findings?: string[];           // bug/decision lines
  cost?: string;                 // Zero: what we actually paid
  source?: string;               // capability slug / repo / "local"
  ms?: number;
}
export interface ProbeReport {
  goal: string;
  target: string;
  startedAt: string;
  probes: Record<ProbeName, ProbeResult>;
  merged?: string[];             // orchestrated shortlist
}

const zj = (args: string[]) => {
  const r = spawnSync(["zero", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: new TextDecoder().decode(r.stdout), err: new TextDecoder().decode(r.stderr) };
};

let report: ProbeReport;
async function flush() { await Bun.write(OUT, JSON.stringify(report, null, 2)); }
async function set(p: ProbeName, patch: Partial<ProbeResult>) {
  report.probes[p] = { ...report.probes[p], ...patch };
  await flush();
}

// pick real source files (skip tests/d.ts) to lint — try several until one has issues
function pickSourceFiles(n = 4): { path: string; code: string }[] {
  const r = spawnSync(["bash", "-lc",
    `cd ${JSON.stringify(TARGET)} && { ls src/*.ts 2>/dev/null; find . -maxdepth 2 -name '*.ts' -not -path '*/node_modules/*'; } ` +
    `| grep -Ev '\\.(test|spec|d)\\.ts$' | head -${n}`],
    { stdout: "pipe" });
  const paths = new TextDecoder().decode(r.stdout).trim().split("\n").filter(Boolean);
  return paths.map(p => {
    const abs = p.startsWith("/") ? p : `${TARGET}/${p}`;
    try { return { path: p, code: spawnSync(["cat", abs], { stdout: "pipe" }).stdout.toString().slice(0, 120_000) }; }
    catch { return null; }
  }).filter(Boolean) as { path: string; code: string }[];
}

// ── PROBE 1: Zero — buy a linter capability, lint real code ──────────
async function zeroProbe() {
  const t = Date.now();
  await set("zero", { status: "running", headline: "searching Zero market for a static-analysis capability…" });
  const s = zj(["search", "javascript static analysis linter bugs", "--json", "--limit", "5", "--max-cost", MAX_PAY, "--protocol", "x402"]);
  if (!s.ok) return set("zero", { status: "error", headline: "zero search failed", detail: s.err.slice(0, 300), ms: Date.now() - t });
  let caps: any[] = [];
  try { caps = JSON.parse(s.out).capabilities ?? []; } catch {}
  const cap = caps.find(c => /lint|static|analysis|bug/i.test(`${c.canonicalName} ${c.description}`) && c.method === "POST" && c.url);
  if (!cap) return set("zero", { status: "empty", headline: "no affordable linter capability found", ms: Date.now() - t });

  await set("zero", { headline: `found: ${cap.canonicalName} ($${cap.cost?.amount}/call) — acquiring via x402…`, source: cap.slug, cost: `$${cap.cost?.amount}` });
  const files = pickSourceFiles(4);
  if (!files.length) return set("zero", { status: "empty", headline: "no source file to lint in target", ms: Date.now() - t });

  // buy once, then reuse the capability across a few files until we surface real issues
  let paid = false, lintedPath = "", findings: string[] = [];
  for (const src of files) {
    const body = JSON.stringify({ code: src.code });
    const f = spawnSync(["zero", "fetch", cap.url, "-X", "POST", "-H", "content-type:application/json", "-d", body, "--max-pay", MAX_PAY, "--protocol", "x402"],
      { stdout: "pipe", stderr: "pipe" });
    if (f.exitCode !== 0) {
      if (!paid) return set("zero", { status: "error", headline: `capability call failed (${cap.slug})`, detail: (new TextDecoder().decode(f.stderr) || new TextDecoder().decode(f.stdout)).slice(0, 400), source: cap.slug, ms: Date.now() - t });
      continue;
    }
    paid = true; lintedPath = src.path;
    const raw = new TextDecoder().decode(f.stdout);
    try {
      const j = JSON.parse(raw);
      const issues = j.issues ?? j.bugs ?? j.errors ?? j.results ?? [];
      findings = (Array.isArray(issues) ? issues : []).slice(0, 12).map((i: any) =>
        `${src.path}:${i.line ?? i.lineNumber ?? "?"} — ${i.message ?? i.rule ?? i.type ?? JSON.stringify(i).slice(0, 80)}`);
    } catch { findings = raw.trim() ? [raw.trim().slice(0, 200)] : []; }
    if (findings.length) break; // got real bugs — stop paying
  }

  await set("zero", {
    status: findings.length ? "ok" : "empty",
    headline: findings.length ? `bought ${cap.canonicalName}, linted ${lintedPath}: ${findings.length} issue(s)` : `linter ran clean across ${files.length} file(s)`,
    detail: `paid $${cap.cost?.amount} USDC via x402 to ${cap.url}`,
    findings, cost: `$${cap.cost?.amount}`, source: cap.slug, ms: Date.now() - t,
  });
}

// ── PROBE 2: steal — mine decisions from a reference repo ────────────
async function stealProbe(goal: string) {
  const t = Date.now();
  await set("steal", { status: "running", headline: `cloning ${STEAL_FROM} to mine prior-art decisions…`, source: STEAL_FROM });
  const dir = cloneReference(STEAL_FROM);
  if (!dir) return set("steal", { status: "error", headline: `clone failed: ${STEAL_FROM}`, ms: Date.now() - t });
  let decisions: StolenDecision[] = [];
  try { decisions = await mineDecisions(STEAL_FROM, dir, goal); } catch (e) {
    return set("steal", { status: "error", headline: "mineDecisions failed", detail: String(e).slice(0, 300), ms: Date.now() - t });
  }
  await set("steal", {
    status: decisions.length ? "ok" : "empty",
    headline: decisions.length ? `stole ${decisions.length} design decision(s) from ${STEAL_FROM}` : "no reusable decisions found",
    findings: decisions.map(d => `${d.decision} — ${d.why}`), source: STEAL_FROM, ms: Date.now() - t,
  });
}

// ── PROBE 3: local — Claude reads target code, proposes bugs ─────────
async function localProbe(goal: string) {
  const t = Date.now();
  await set("local", { status: "running", headline: "Claude scanning target source for candidate bugs…", source: "local" });
  let out = "";
  try {
    out = await ask(
      `You are a code auditor. Goal: ${goal}\n` +
      `Look at the source in this repo and list up to 6 concrete candidate bugs or risky patterns. ` +
      `One per line, format: "FILE:LINE — issue". Be specific; no preamble.`,
      { allowTools: true, maxTurns: 12, cwd: TARGET });
  } catch (e) {
    return set("local", { status: "error", headline: "local audit failed", detail: String(e).slice(0, 300), ms: Date.now() - t });
  }
  const findings = out.split("\n").map(l => l.trim()).filter(l => /—|:/.test(l) && l.length > 8).slice(0, 6);
  await set("local", {
    status: findings.length ? "ok" : "empty",
    headline: findings.length ? `Claude found ${findings.length} candidate issue(s)` : "no candidates surfaced",
    findings, source: "local", ms: Date.now() - t,
  });
}

// merge: cheap union with light dedup — the "orchestrate" step
function merge() {
  const all = (["zero", "steal", "local"] as ProbeName[]).flatMap(p => (report.probes[p].findings ?? []).map(f => `[${p}] ${f}`));
  const seen = new Set<string>();
  report.merged = all.filter(f => { const k = f.toLowerCase().replace(/\s+/g, " ").slice(0, 60); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 20);
}

export async function runProbes(goal: string): Promise<ProbeReport> {
  const blank = (probe: ProbeName): ProbeResult => ({ probe, status: "running", headline: "queued" });
  report = { goal, target: TARGET, startedAt: new Date().toISOString(),
    probes: { zero: blank("zero"), steal: blank("steal"), local: blank("local") } };
  await flush();
  await Promise.allSettled([zeroProbe(), stealProbe(goal), localProbe(goal)]);
  merge(); await flush();
  return report;
}

if (import.meta.main) {
  const goal = process.argv.slice(2).join(" ") || "find bugs in the target codebase";
  runProbes(goal).then(r => {
    const n = (p: ProbeName) => r.probes[p].findings?.length ?? 0;
    console.log(`\nprobes done — zero:${n("zero")} steal:${n("steal")} local:${n("local")} merged:${r.merged?.length ?? 0}`);
    process.exit(0);
  });
}
