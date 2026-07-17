// Buildkite operations via the hosted MCP server — observe & annotate are the loop's eyes and voice.
import { mcpCall } from "./mcp-client";
import type { BuildResult } from "./types";

const ORG = process.env.BUILDKITE_ORG ?? "";
const PIPELINE = process.env.BUILDKITE_PIPELINE ?? "";

export async function createBuild(branch: string, commit: string, message: string): Promise<BuildResult> {
  const b = await mcpCall("create_build", {
    org_slug: ORG, pipeline_slug: PIPELINE,
    branch, commit, message,
  });
  return toResult(b);
}

export async function getBuild(number: number): Promise<BuildResult> {
  const b = await mcpCall("get_build", {
    org_slug: ORG, pipeline_slug: PIPELINE, build_number: String(number),
  });
  return toResult(b);
}

export async function waitForBuild(number: number, timeoutSec = 600): Promise<BuildResult> {
  const start = Date.now();
  for (;;) {
    const b = await getBuild(number);
    // "failing" = a job already declared failure while build still running — early observe signal
    if (["passed", "failed", "canceled", "failing"].includes(b.state)) {
      if (b.state === "failing") {
        // wait for terminal state so logs are complete, but we already KNOW it's red
        const done = await waitTerminal(number, timeoutSec - (Date.now() - start) / 1000);
        return done;
      }
      return b;
    }
    if ((Date.now() - start) / 1000 > timeoutSec) throw new Error(`build #${number} timed out`);
    await Bun.sleep(5000);
  }
}

async function waitTerminal(number: number, timeoutSec: number): Promise<BuildResult> {
  const start = Date.now();
  for (;;) {
    const b = await getBuild(number);
    if (["passed", "failed", "canceled"].includes(b.state)) return b;
    if ((Date.now() - start) / 1000 > timeoutSec) return b;
    await Bun.sleep(5000);
  }
}

export function tailLogArguments(org: string, pipeline: string, buildNumber: number, job: { id?: string; uuid?: string }) {
  return {
    org_slug: org,
    pipeline_slug: pipeline,
    build_number: String(buildNumber),
    job_id: job.id ?? job.uuid ?? "",
    tail: 100,
  };
}

// Pull failing job logs — the raw material for self-correction.
export async function failedLogs(buildNumber: number): Promise<string> {
  const jobs = await mcpCall("list_jobs", {
    org_slug: ORG, pipeline_slug: PIPELINE, build_number: String(buildNumber),
  });
  const list = Array.isArray(jobs) ? jobs : jobs?.jobs ?? jobs?.items ?? [];
  const failed = list.filter((j: any) => j.state === "failed" || j.exit_status > 0);
  let out = "";
  for (const j of failed) {
    try {
      const log = await mcpCall("tail_logs", tailLogArguments(ORG, PIPELINE, buildNumber, j));
      out += `\n### job: ${j.name ?? j.id ?? j.uuid}\n${typeof log === "string" ? log : JSON.stringify(log)}\n`;
    } catch (e) {
      out += `\n### job: ${j.name ?? j.id ?? j.uuid} (log fetch failed: ${e})\n`;
    }
  }
  return out || "(no failed job logs found)";
}

// Every loop iteration narrates its reasoning onto the build page — auditable autonomy.
export async function annotate(buildNumber: number, body: string, style: "info" | "warning" | "error" | "success", context: string): Promise<void> {
  await mcpCall("create_annotation", {
    org_slug: ORG, pipeline_slug: PIPELINE, build_number: String(buildNumber),
    body, style, context,
  });
}

function toResult(b: any): BuildResult {
  return { state: b.state, number: b.number, webUrl: b.web_url ?? b.webUrl ?? "" };
}
