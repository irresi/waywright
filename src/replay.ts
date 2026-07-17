// Time-axis replay of the REAL run: drives BOTH .ouroboros/state.json (phase
// pipeline + event stream) and .ouroboros/probes.json (the 3 probe lanes) so the
// whole dashboard evolves step by step — probes light up running→ok during the
// plan phase, then the loop closes through implement→gate→merge.
//
// Source of truth is probes.final.json (the actual probe run). We re-emit it
// paced; nothing here is fabricated — it's the real run, replayed for the camera.
// Replay-local view types. The loop's runtime types were refactored out of
// ./types during the in-tree teach merge; replay drives the dashboard JSON
// directly, so it owns the minimal shape it writes.
type Phase = "plan" | "implement" | "ci" | "observe" | "gate" | "merge" | "teach" | "done";
type LoopEvent = { ts: string; phase: Phase; summary: string; detail?: string };
type LoopState = {
  phase: Phase; specPath: string; targetRepo: string; branch: string;
  iteration: number; maxIterations: number; log: LoopEvent[]; stolen: unknown[];
  prNumber?: number; buildNumber?: number;
};

const STATE = process.env.OUROBOROS_STATE ?? ".ouroboros/state.json";
const PROBES = process.env.PROBE_OUT ?? ".ouroboros/probes.json";
const FINAL = process.env.PROBE_FINAL ?? ".ouroboros/probes.final.json";
const STEP = Number(process.env.STEP_MS ?? 1600);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const real = JSON.parse(await Bun.file(FINAL).text());
const goal = real.goal as string;

// ── shared state (bottom half) ──────────────────────────────────────
const state: LoopState = {
  phase: "plan", specPath: `goal: ${goal}`,
  targetRepo: "irresi/openclaw", branch: "fix/announce-log-codepoints",
  iteration: 1, maxIterations: 3, log: [], stolen: [],
};

// ── probe view (top half), rebuilt each tick ────────────────────────
type PV = { probe?: string; status?: string; headline?: string; detail?: string; findings?: string[]; cost?: string; source?: string; ms?: number };
const probes: { goal: string; target: string; startedAt: string; probes: Record<string, PV>; merged: string[] } = {
  goal, target: real.target, startedAt: new Date().toISOString(),
  probes: {
    zero:  { probe: "zero",  status: "queued", headline: "queued" },
    steal: { probe: "steal", status: "queued", headline: "queued" },
    local: { probe: "local", status: "queued", headline: "queued" },
  },
  merged: [],
};

async function writeProbes() { await Bun.file(PROBES); await Bun.write(PROBES, JSON.stringify(probes, null, 2)); }
async function writeState() { await Bun.write(STATE, JSON.stringify(state, null, 2)); }

async function ev(phase: Phase, summary: string, detail?: string, patch: Partial<LoopState> = {}) {
  Object.assign(state, patch); state.phase = phase;
  const e: LoopEvent = { ts: new Date().toISOString(), phase, summary, detail };
  state.log.push(e); await writeState();
  console.log(`[state:${phase}] ${summary}`);
}
async function probe(name: string, patch: Partial<PV>, note: string) {
  probes.probes[name] = { ...probes.probes[name], ...patch };
  await writeProbes();
  console.log(`[probe:${name}] ${note}`);
}
const settle = (name: string): PV => {
  const r = real.probes[name];
  return { probe: name, status: r.status, headline: r.headline, detail: r.detail, findings: r.findings, cost: r.cost, source: r.source, ms: r.ms };
};
async function step<T>(fn: () => Promise<T>) { const v = await fn(); await sleep(STEP); return v; }

// ═══ RUN ════════════════════════════════════════════════════════════
await writeProbes(); await writeState();

// plan: the goal, then three judges light up
await step(() => ev("plan", `goal received: "${goal}"`, "fan out to 3 parallel judges → shared memory"));

await step(() => probe("zero", { status: "running", headline: "searching Zero market for a static-analysis capability…", source: "capability market" }, "zero searching"));
await step(() => probe("steal", { status: "running", headline: `cloning irresi/hermes-agent…`, source: "irresi/hermes-agent" }, "steal cloning"));
await step(() => probe("local", { status: "running", headline: "Claude scanning openclaw source…", source: "local" }, "local scanning"));

// they settle in the order they really finished (zero fast, steal/local ~46s)
await step(async () => { await probe("zero", settle("zero"), "zero ok"); await ev("plan", "Zero bought JS static-analysis capability ($0.002 via x402)", real.probes.zero.headline); });
await step(async () => {
  await probe("steal", settle("steal"), "steal ok");
  state.stolen = (real.probes.steal.findings ?? []).slice(0, 3).map((f: string) => { const [d, w] = f.split(" — "); return { repo: "irresi/hermes-agent", decision: d, why: w ?? "" }; });
  await ev("plan", "stole 3 design decisions from irresi/hermes-agent", "SSRF guard · shared path validator · write-origin provenance");
});
await step(async () => { await probe("local", settle("local"), "local ok"); await ev("plan", "Claude audit surfaced 6 candidate issues"); });

// merge the shortlist (top-half orchestration), then note it below
await step(async () => { probes.merged = real.merged ?? []; await writeProbes(); await ev("plan", `orchestrated shortlist: ${probes.merged.length} findings across 3 judges`, "three judges, one memory"); });

// implement → gate → merge (bottom half), probes stay settled up top
await step(() => ev("implement", "picked smallest honest fix: promptChars counts code units, not codepoints", "execute.ts:158"));
await step(() => ev("implement", "opened issue #1", "https://github.com/irresi/openclaw/issues/1"));
await step(() => ev("implement", "pushed fix, opened PR #2", "https://github.com/irresi/openclaw/pull/2", { prNumber: 2 }));
await step(() => ev("ci", "verified: emoji 7→5 (code units→codepoints), Korean unchanged", "no BMP regression", { buildNumber: 2 }));
await step(() => ev("observe", "green — requesting merge approval from the policy gate", "Pomerium PPL merge-gate"));
await step(() => ev("gate", "gate verdict: ALLOW — identity ✓ budget 1/3 ✓ pr #2 ✓", "via gate-service"));
await step(() => ev("merge", "squash-merged PR #2 → main @ ae3b9de", "closes #1"));
await step(() => ev("teach", "generating the human-context record for the merged change", "the audit trail is the UI"));
await ev("done", "loop closed: vague goal → 3 judges → real issue → PR → policy-gated merge", "all real, all on GitHub");

console.log("\nreplay complete — state + probes evolved through the full run");
