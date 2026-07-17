import { resolve } from "node:path";
import { actuate } from "./actuator";
import { GBrainCliPageStore, GBrainEngineeringMemory } from "./memory";
import { createProductionActuator } from "./production-actuator";
import { createMemoryRecord } from "./run-memory";
import type { NavigationResult } from "./types";

if (import.meta.main) {
  const targetDir = resolve(process.env.TARGET_DIR ?? process.cwd());
  const targetRepo = process.env.TARGET_REPO;
  if (!targetRepo) {
    console.error("TARGET_REPO=owner/repo is required");
    process.exit(1);
  }
  const planPath = resolve(process.argv[2] ?? `${targetDir}/.waywright/plan.md`);
  const navigationPath = resolve(targetDir, ".waywright/navigation.json");
  const plan = await Bun.file(planPath).text();
  const navigation = await Bun.file(navigationPath).json() as NavigationResult;
  const result = await actuate(plan, createProductionActuator({ targetDir, targetRepo }), {
    maxIterations: Number(process.env.MAX_ITERATIONS ?? 3),
  });
  const createdAt = new Date().toISOString();
  const memoryRecord = createMemoryRecord(navigation, result, {
    id: `D-${createdAt.replace(/\D/g, "").slice(0, 14)}`,
    createdAt,
  });
  const memory = new GBrainEngineeringMemory(new GBrainCliPageStore());
  await memory.remember(memoryRecord);
  await Promise.all([
    Bun.write(resolve(targetDir, ".waywright/actuation.json"), JSON.stringify(result, null, 2)),
    Bun.write(resolve(targetDir, ".waywright/memory-written.json"), JSON.stringify(memoryRecord, null, 2)),
  ]);
  console.log(`[MEMORY] wrote ${memoryRecord.id} to gbrain`);
  console.log(`[RESULT] ${result.status}`);
  process.exit(result.status === "merged" ? 0 : 1);
}
