// Headless Claude wrapper — runs on the local `claude` CLI (subscription), no API key.
// Every LLM call in the loop goes through here.
import { spawn } from "bun";

export async function ask(prompt: string, opts: { cwd?: string; allowTools?: boolean; maxTurns?: number } = {}): Promise<string> {
  const args = ["-p", prompt, "--output-format", "text"];
  if (opts.allowTools) {
    args.push("--allowedTools", "Bash,Read,Write,Edit,Glob,Grep", "--permission-mode", "acceptEdits");
  }
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));

  const proc = spawn(["claude", ...args], {
    cwd: opts.cwd ?? process.cwd(),
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ANTHROPIC_API_KEY: "" }, // force subscription path
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`claude exited ${code}: ${err.slice(0, 500)}`);
  return out.trim();
}
