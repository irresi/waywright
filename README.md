# Waywright

> Give it a goal, not a ticket.

Waywright is a self-directing engineering agent. It observes the current project, scouts prior art, proposes competing directions, selects one with explicit evidence, then drives that direction through implementation, real CI, self-correction, policy approval, and merge.

Most coding agents execute a direction somebody already chose. Waywright finds the direction and ships it.

## The loop

```text
HIGH-LEVEL GOAL
      │
      ▼
┌──────────── NAVIGATOR ────────────┐
│ Context → Scout → Branch → Decide │
│                  → Plan           │
└────────────────┬──────────────────┘
                 │ approved direction
                 ▼
┌───────────── ACTUATOR ────────────┐
│ Implement → Buildkite → Observe   │
│      ▲                     │ red  │
│      └──── minimal fix ◀───┘      │
└────────────────┬──────────────────┘
                 │ green
                 ▼
        Pomerium policy boundary
                 │ allow
                 ▼
               MERGE
                 │
        ┌────────┴────────┐
        ▼                 ▼
 human-context edge    next direction
```

## Auditable direction finding

A run produces three artifacts in the target repository:

- `.waywright/navigation.json` — observed context, all candidates, evidence, and prior art
- `.waywright/direction.md` — readable decision record, including rejected alternatives
- `.waywright/plan.md` — executable implementation and RED/GREEN verification plan

The agent cannot silently jump from goal to code. Its chosen direction and rejected alternatives remain reviewable.

## Sponsor integrations

### Buildkite — Sensor and audit surface

Waywright speaks JSON-RPC directly to Buildkite's hosted MCP server. It creates builds, observes terminal state, retrieves failed job logs, and posts each correction as a Buildkite annotation. The CI page is the live audit trail rather than a fabricated dashboard.

### Pomerium — Autonomous-action governor

The merge service sits behind a Pomerium policy boundary. The coding agent may create branches, write code, run CI, and revise its work, but merge requires an allowed identity and runtime policy. The client fails closed: an unreachable gate cannot result in a merge.

### Zero.xyz — Capability acquisition

When a selected direction requires an ability Waywright does not have locally, it can discover and invoke an affordable capability from Zero's market under a spend limit. Capability use is explicit in the run record.

### Nexla — future enterprise context provider, not part of this build

The current Navigator reads local repository, GitHub, Buildkite, and decision history directly. Its `ContextProvider` boundary can later be backed by Nexla to supply governed product, customer, and operational signals. We do not claim Nexla as an implemented sponsor integration.

## Human understanding is an edge, not the whole product

A merged change can emit multiple edges: deployment, a decision record, a learning artifact, or the next autonomous direction. For the demo goal, Waywright independently selected a counterfactual replay: an executable test that fails on the parent commit and passes after the change. That makes the behavioral delta objective instead of generating another passive PR summary.

## Run

Prerequisites: Bun, authenticated `claude`, `gh`, Buildkite token/config, and a target Git repository.

```bash
bun install

# 1. Discover a direction from a high-level goal.
TARGET_DIR=../target bun run navigate ./demo/goal.md

# 2. Start the policy service (Pomerium fronts this in the full demo).
bun run gate/server.ts

# 3. Execute the selected plan.
export BUILDKITE_API_TOKEN=...
export BUILDKITE_ORG=...
export BUILDKITE_PIPELINE=...
export TARGET_DIR=../target
export TARGET_REPO=owner/repo
bun run execute
```

## Safety rails

- Bounded correction budget; exhaustion stops before PR creation.
- CI must be green before a merge request is created.
- Merge policy is fail-closed.
- Corrections request minimal code-only diffs and may not edit CI configuration.
- Candidate directions, evidence, rejected alternatives, builds, and corrections are durable artifacts.

## Hackathon provenance

This repository and submitted implementation were created during the Loop Engineering Challenge on July 17, 2026. Prior projects were not copied into this codebase. Existing workflows informed the design, while all submitted implementation is fresh.
