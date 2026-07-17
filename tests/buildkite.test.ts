import { describe, expect, test } from "bun:test";
import { tailLogArguments } from "../src/buildkite";

describe("Buildkite MCP arguments", () => {
  test("tail_logs uses the schema-required job_id field", () => {
    expect(tailLogArguments("org", "pipe", 2, { id: "job-123" })).toEqual({
      org_slug: "org",
      pipeline_slug: "pipe",
      build_number: "2",
      job_id: "job-123",
      tail: 100,
    });
  });
});
