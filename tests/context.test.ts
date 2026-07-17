import { afterEach, describe, expect, test } from "bun:test";
import { gatherEngineeringContext } from "../src/context";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "bun";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe("engineering context", () => {
  test("grounds direction finding in the current repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waywright-context-"));
    dirs.push(dir);
    await Bun.write(join(dir, "package.json"), JSON.stringify({ name: "demo-api", scripts: { test: "bun test" } }));
    await Bun.write(join(dir, "README.md"), "# Demo API\nA tiny service for links.");
    spawnSync(["git", "init", "-q"], { cwd: dir });
    spawnSync(["git", "add", "."], { cwd: dir });
    spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"], { cwd: dir });

    const signals = await gatherEngineeringContext("improve onboarding", dir);

    expect(signals.some(signal => signal.source === "repository" && signal.summary.includes("demo-api"))).toBe(true);
    expect(signals.some(signal => signal.source === "git" && signal.evidence.includes("initial"))).toBe(true);
  });
});
