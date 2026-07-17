/**
 * extractors/pr/claude.ts — run the extraction prompt through the LOCAL Claude
 * Code CLI (subscription-based, decision D-011), not an API key.
 *
 * Auth is abstracted: the default provider shells out to `claude -p` in headless
 * mode, which uses whatever credential the CLI already has (the user's Pro/Max
 * subscription via /login, or CLAUDE_CODE_OAUTH_TOKEN in CI). Swapping to an
 * API-key provider later is a one-file change — the product must not depend on
 * "free via subscription" (D-011), but subscription is the default path.
 */
import { $ } from "bun";

export interface LlmProvider {
  name: string;
  /** Given a prompt, return the model's raw text output. */
  complete(prompt: string): Promise<string>;
}

/**
 * Subscription provider: `claude -p <prompt> --output-format json`.
 * We read structured stdout and pull the result text. Runs on the user's own
 * Claude Code credentials — zero operator inference cost (Pool 2 economics).
 */
export const claudeCliProvider: LlmProvider = {
  name: "claude-cli (subscription)",
  async complete(prompt: string): Promise<string> {
    // --output-format json gives a machine-readable envelope with a `result` field.
    // Pass the prompt on stdin (Bun Shell accepts a Buffer/Blob as < redirect input)
    // to avoid arg-length limits on the large schema.
    const stdin = new Response(prompt);
    const res = await $`claude -p --output-format json < ${stdin}`.quiet();
    const raw = res.stdout.toString();
    try {
      const env = JSON.parse(raw);
      // headless envelope: { type:"result", result:"<text>", ... }
      return typeof env.result === "string" ? env.result : raw;
    } catch {
      return raw; // fall back to raw stdout (e.g. plain text mode)
    }
  },
};

/** Extract the first top-level JSON object from a model response. */
export function extractJsonObject(text: string): string {
  // strip common fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model output");
  // balance braces to find the matching close
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return body.slice(start, i + 1); }
    }
  }
  throw new Error("unbalanced JSON braces in model output");
}
