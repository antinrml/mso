import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

export type McpActivityState = "started" | "completed" | "failed" | "denied" | "rate_limited";

export interface McpActivityEntry {
  id: string;
  ts: string;
  actor?: string | null;
  tool: string;
  state: McpActivityState;
  scope?: string;
  target?: string;
  durationMs?: number;
  detail?: string;
}

function activityPath(): string {
  const env = process.env.OS_MCP_ACTIVITY_LOG;
  if (env && env.trim()) return env.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(os.homedir(), ".mso", "mcp-activity.log");
}

function trunc(v: string | undefined, max = 180): string | undefined {
  if (!v) return undefined;
  return v.length > max ? v.slice(0, max) + "…" : v;
}

let chain: Promise<void> = Promise.resolve();

export function newActivityId(): string {
  return randomUUID();
}

export function activityTarget(args: Record<string, unknown>): string | undefined {
  // Never serialize fs_write.content or arbitrary payloads. Prefer the one field
  // that explains what the tool is acting on without leaking the body.
  for (const key of ["path", "id", "query", "from", "command", "on"] as const) {
    const v = args[key];
    if (typeof v === "string" && v) return trunc(v);
    if (typeof v === "boolean") return String(v);
  }
  return undefined;
}

export function recordMcpActivity(entry: Omit<McpActivityEntry, "ts"> & { ts?: string }): Promise<void> {
  if (process.env.VITEST && !process.env.OS_MCP_ACTIVITY_LOG) return Promise.resolve();
  const line = JSON.stringify({
    ...entry,
    ts: entry.ts ?? new Date().toISOString(),
    target: trunc(entry.target),
    detail: trunc(entry.detail, 220),
  }) + "\n";
  chain = chain.then(async () => {
    const file = activityPath();
    try {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.appendFile(file, line, { mode: 0o600 });
    } catch (e) {
      console.error("[mcp-activity] write failed:", e instanceof Error ? e.message : e);
    }
  });
  return chain;
}

export async function readMcpActivity(limit = 80): Promise<McpActivityEntry[]> {
  const raw = await fs.readFile(activityPath(), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-800)
    .map((line) => {
      try { return JSON.parse(line) as McpActivityEntry; } catch { return null; }
    })
    .filter((v): v is McpActivityEntry => Boolean(v?.id && v?.tool && v?.state))
    .slice(-Math.min(Math.max(limit, 1), 200))
    .reverse();
}
