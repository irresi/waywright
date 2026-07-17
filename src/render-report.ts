import { resolve } from "node:path";
import type { ActuatorResult } from "./actuator";
import { renderWaywrightReport } from "./report";
import type { EngineeringMemoryRecord, NavigationResult } from "./types";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  return await file.exists() ? JSON.parse(await file.text()) as T : undefined;
}

const waywrightDir = resolve(process.cwd(), ".waywright");
const navigation = await readJson<NavigationResult>(resolve(waywrightDir, "navigation.json"));
const actuation = await readOptionalJson<ActuatorResult>(resolve(waywrightDir, "actuation.json"));
const memoryWritten = await readOptionalJson<EngineeringMemoryRecord>(resolve(waywrightDir, "memory-written.json"));
const html = renderWaywrightReport({ navigation, actuation, memoryWritten });

await Bun.write(resolve(waywrightDir, "report.html"), html);
