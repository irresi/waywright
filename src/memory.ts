import { resolve } from "node:path";
import type { EngineeringMemoryRecord } from "./types";

const DEFAULT_SLUG = "projects/waywright/engineering-memory";
const FENCE = /```json memory\s*\n([\s\S]*?)\n```/;

export interface EngineeringMemory {
  recall(goal: string, limit?: number): Promise<EngineeringMemoryRecord[]>;
  remember(record: EngineeringMemoryRecord): Promise<void>;
}

export interface GBrainPageStore {
  get(slug: string): Promise<string | null>;
  put(slug: string, content: string): Promise<void>;
}

function parseRecords(page: string | null): EngineeringMemoryRecord[] {
  if (!page) return [];
  const payload = page.match(FENCE)?.[1];
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9가-힣]{3,}/g) ?? []);
}

function relevance(record: EngineeringMemoryRecord, query: Set<string>): number {
  const document = tokens(JSON.stringify(record));
  return [...query].reduce((score, token) => score + Number(document.has(token)), 0);
}

function render(records: EngineeringMemoryRecord[]): string {
  return `---\ntitle: Waywright Engineering Memory\ntype: engineering-memory\ntags: [waywright, decisions, outcomes]\n---\n\n# Waywright Engineering Memory\n\nShared decision and outcome memory for the Waywright agent and its human operators.\n\n\`\`\`json memory\n${JSON.stringify(records, null, 2)}\n\`\`\`\n`;
}

export class GBrainEngineeringMemory implements EngineeringMemory {
  constructor(
    private readonly store: GBrainPageStore,
    private readonly slug = DEFAULT_SLUG,
  ) {}

  async recall(goal: string, limit = 8): Promise<EngineeringMemoryRecord[]> {
    const records = parseRecords(await this.store.get(this.slug));
    const query = tokens(goal);
    return records
      .map(record => ({ record, score: relevance(record, query) }))
      .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
      .slice(0, limit)
      .map(item => item.record);
  }

  async remember(record: EngineeringMemoryRecord): Promise<void> {
    const records = parseRecords(await this.store.get(this.slug));
    const index = records.findIndex(item => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    await this.store.put(this.slug, render(records));
  }
}

export class GBrainCliPageStore implements GBrainPageStore {
  private readonly cli: string;

  constructor(cli = process.env.GBRAIN_CLI ?? "~/codes/gbrain/src/cli.ts") {
    this.cli = resolve(cli.replace(/^~(?=\/)/, process.env.HOME ?? ""));
  }

  async get(slug: string): Promise<string | null> {
    const proc = Bun.spawn([process.execPath, "run", this.cli, "get", slug], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    if (await proc.exited !== 0 || /not found/i.test(output)) return null;
    return output.trim() || null;
  }

  async put(slug: string, content: string): Promise<void> {
    const proc = Bun.spawn([process.execPath, "run", this.cli, "put", slug], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(content);
    proc.stdin.end();
    const error = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`gbrain put ${slug} failed: ${error.trim()}`);
  }
}
