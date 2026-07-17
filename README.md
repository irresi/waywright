# Ouroboros

**A self-directing agent that closes the whole loop — including the human one.**

Spec in → the agent **plans by stealing prior art** (clones the closest OSS references and
mines their design decisions) → **implements** → runs **CI** → **observes** failures →
**self-corrects** with minimal diffs (every iteration's reasoning annotated on the build
page) → passes an **identity-aware policy gate** → **merges** → and finally **teaches the
human** what it built, as an interactive comic episode.

Everyone else closes the machine loop. Machine-green is not done — *done is when the
human understands what merged.* Ouroboros closes both.

```
spec ─▶ plan (steal prior art) ─▶ implement ─▶ CI ─▶ observe ─┐
  ▲                                                           │ red? self-correct
  │                                                           ▼ (annotated, minimal diff)
teach human ◀─ merge ◀─ policy gate (Pomerium PPL) ◀─────── green
(comic episode)
```

## Sponsor tools used (3+)

| Tool | Role in the loop |
| --- | --- |
| **Buildkite** (hosted MCP server, `/direct` headless) | The loop's eyes & voice: `create_build`, `get_build`, `list_jobs`, `tail_logs` for observe; `create_annotation` narrates every self-correction on the build page — auditable autonomy. We speak MCP JSON-RPC directly (`src/mcp-client.ts`). |
| **Pomerium** (PPL policy + identity headers) | The loop's conscience: the merge-gate service sits behind a Pomerium route (`gate/pomerium.yaml`); PPL decides which identity may request an autonomous merge. Fail-closed — no gate, no merge. |
| **Zero.xyz** (capability market, x402) | The loop's hands when its own aren't enough: mid-loop capability search & paid acquisition with the agent's own managed wallet (`src/zero.ts`). |

## The human-context layer

Post-merge, Ouroboros calls [human-mem](https://github.com/irresi/human-mem) (our
open-source side project, used here as an external tool like `gh` or `claude`) to turn
the merged PR into an interactive comic episode — so the human's understanding keeps up
with the agent's output. AI code you don't understand is a liability; this repays the
cognitive debt in the same loop that created it.

## Run

```bash
bun install
# terminal 1: the policy gate (behind Pomerium in prod; direct in dev)
bun run gate/server.ts
# terminal 2: the loop
export BUILDKITE_API_TOKEN=bkua_... BUILDKITE_ORG=... BUILDKITE_PIPELINE=...
export TARGET_DIR=../demo-target TARGET_REPO=owner/name
bun run src/loop.ts specs/demo.md
```

## Safety rails
- Iteration budget (`maxIterations`, default 4) — loop cannot run forever.
- Policy gate is **fail-closed**: unreachable gate = merge denied.
- Minimal-diff principle enforced in every correction prompt.
- Every decision annotated on the Buildkite build page — the audit trail *is* the UI.

Built at the Loop Engineering Hackathon (SF, 2026-07-17).
