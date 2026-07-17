// Merge gate — policy check before autonomous merge.
// Runs against a Pomerium-fronted gate service: the agent's request must pass
// an identity-aware PPL policy before it is allowed to merge its own PR.
// deny always wins; the agent cannot bypass the proxy.

const GATE_URL = process.env.GATE_URL ?? "http://localhost:8081/gate/merge";

export interface GateVerdict {
  allowed: boolean;
  reason: string;
  via: string; // which enforcement path answered
}

export async function requestMergeApproval(payload: {
  repo: string; pr: number; iterations: number; buildUrl: string;
}): Promise<GateVerdict> {
  try {
    const res = await fetch(GATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 403) {
      return { allowed: false, reason: await res.text(), via: "pomerium-ppl" };
    }
    if (!res.ok) return { allowed: false, reason: `gate HTTP ${res.status}`, via: "gate-error" };
    const v = await res.json() as { allowed: boolean; reason: string };
    return { ...v, via: "gate-service" };
  } catch (e) {
    // fail CLOSED: no gate, no merge
    return { allowed: false, reason: `gate unreachable: ${e}`, via: "fail-closed" };
  }
}
