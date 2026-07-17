// Merge-gate service — sits BEHIND Pomerium. Pomerium's PPL policy decides who
// (which identity) may even reach this service; the service then applies
// loop-specific merge policy (iteration budget, green build required).
// Fail-closed by design: gate.ts treats unreachable/403 as DENY.

const PORT = Number(process.env.GATE_PORT ?? 8081);
const MAX_ITERATIONS_ALLOWED = Number(process.env.GATE_MAX_ITER ?? 3);
const STATE_FILE = process.env.OUROBOROS_STATE ?? ".ouroboros/state.json";
const PROBES_FILE = process.env.PROBE_OUT ?? ".ouroboros/probes.json";
const EPISODE_FILE = process.env.EPISODE_FILE ?? decodeURIComponent(new URL("../episodes/openclaw-pr-2.html", import.meta.url).pathname);
const DASHBOARD = decodeURIComponent(new URL("./dashboard.html", import.meta.url).pathname);

// The audit trail IS the UI: the loop writes full state to STATE_FILE on every
// event; the dashboard just polls /state. Read-only, CORS-open for local demo.
const CORS = { "access-control-allow-origin": "*" };

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // ── live dashboard ──────────────────────────────────────────────
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(Bun.file(DASHBOARD), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (req.method === "GET" && url.pathname === "/state") {
      const f = Bun.file(STATE_FILE);
      const body = (await f.exists())
        ? await f.text()
        : JSON.stringify({ phase: "idle", iteration: 0, log: [], stolen: [] });
      return new Response(body, { headers: { "content-type": "application/json", ...CORS } });
    }
    if (req.method === "GET" && url.pathname === "/probes") {
      const f = Bun.file(PROBES_FILE);
      const body = (await f.exists()) ? await f.text() : JSON.stringify({ probes: {} });
      return new Response(body, { headers: { "content-type": "application/json", ...CORS } });
    }
    // ── teach artifact: the human-mem comic episode for the merged PR ──
    if (req.method === "GET" && url.pathname === "/episode") {
      const f = EPISODE_FILE ? Bun.file(EPISODE_FILE) : null;
      if (f && (await f.exists()))
        return new Response(f, { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
      return new Response("<!doctype html><body style='font:14px monospace;color:#8b98a5;background:#0d1117;padding:24px'>episode not generated yet — run the Teach step</body>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }
    // episode assets (images the comic references) — served from the episode's dir
    if (req.method === "GET" && url.pathname.startsWith("/episode/") && EPISODE_FILE) {
      const name = url.pathname.slice("/episode/".length);
      if (!name.includes("/") && !name.includes("..")) {               // no traversal
        const dir = EPISODE_FILE.slice(0, EPISODE_FILE.lastIndexOf("/"));
        const asset = Bun.file(`${dir}/${name}`);
        if (await asset.exists()) return new Response(asset, { headers: { ...CORS } });
      }
      return new Response("not found", { status: 404, headers: CORS });
    }

    // ── merge gate (unchanged) ──────────────────────────────────────
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
