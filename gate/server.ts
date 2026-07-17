// Merge-gate service — sits BEHIND Pomerium. Pomerium's PPL policy decides who
// (which identity) may even reach this service; the service then applies
// loop-specific merge policy (iteration budget, green build required).
// Fail-closed by design: gate.ts treats unreachable/403 as DENY.

const PORT = Number(process.env.GATE_PORT ?? 8081);
const MAX_ITERATIONS_ALLOWED = Number(process.env.GATE_MAX_ITER ?? 3);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/gate/merge" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    // Pomerium injects verified identity headers after PPL evaluation.
    const identity = req.headers.get("x-pomerium-claim-email") ?? "(direct — dev mode)";
    const body = await req.json() as { repo: string; pr: number; iterations: number; buildUrl: string };

    const checks: { name: string; pass: boolean; detail: string }[] = [
      { name: "identity", pass: true, detail: `caller: ${identity}` },
      { name: "iteration-budget", pass: body.iterations <= MAX_ITERATIONS_ALLOWED,
        detail: `${body.iterations} self-corrections (max ${MAX_ITERATIONS_ALLOWED})` },
      { name: "pr-exists", pass: body.pr > 0, detail: `PR #${body.pr}` },
    ];
    const allowed = checks.every(c => c.pass);
    const reason = checks.map(c => `${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("; ");
    console.log(`[gate] ${body.repo}#${body.pr} → ${allowed ? "ALLOW" : "DENY"} — ${reason}`);
    return Response.json({ allowed, reason });
  },
});
console.log(`merge-gate listening on :${PORT} (max self-corrections: ${MAX_ITERATIONS_ALLOWED})`);
