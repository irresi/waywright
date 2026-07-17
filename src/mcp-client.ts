// Minimal MCP client for Buildkite's hosted MCP server (streamable HTTP, /direct token pass-through).
// We speak JSON-RPC 2.0 directly — no SDK — so the loop agent is a native MCP client.
const ENDPOINT = process.env.BUILDKITE_MCP_URL ?? "https://mcp.buildkite.com/direct";
const TOKEN = process.env.BUILDKITE_API_TOKEN ?? "";

let sessionId: string | undefined;
let nextId = 1;

async function rpc(method: string, params?: unknown): Promise<any> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (!res.ok) throw new Error(`MCP ${method} → HTTP ${res.status}: ${await res.text()}`);

  const ctype = res.headers.get("content-type") ?? "";
  let payload: any;
  if (ctype.includes("text/event-stream")) {
    // parse SSE: take the last `data:` line containing our response
    const text = await res.text();
    const datas = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
    payload = JSON.parse(datas[datas.length - 1]!);
  } else {
    payload = await res.json();
  }
  if (payload.error) throw new Error(`MCP ${method} error: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

export async function mcpInit(): Promise<void> {
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "ouroboros", version: "0.1.0" },
  });
  await notify("notifications/initialized");
}

async function notify(method: string): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method }) });
}

export async function mcpCall(tool: string, args: Record<string, unknown>): Promise<any> {
  const result = await rpc("tools/call", { name: tool, arguments: args });
  // MCP tool results carry content blocks; unwrap first text block as JSON when possible
  const text = result?.content?.find((c: any) => c.type === "text")?.text;
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return result;
}

export async function mcpListTools(): Promise<string[]> {
  const result = await rpc("tools/list", {});
  return (result?.tools ?? []).map((t: any) => t.name);
}
