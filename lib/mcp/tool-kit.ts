import type { AuditAction } from "@/lib/host";
import type { Scope } from "./scope";

// Shared shapes for the MCP tool catalog. EVERY handler goes through lib/host — never node fs or
// child_process directly — so all of it inherits the bounds that already guard
// /api/v1: OS_FS_READ_ROOTS / OS_FS_WRITE_ROOTS, the credential denylist
// (~/.ssh, ~/.mso itself, cloud + AI tokens), realpath escape checks, and the
// catastrophic-command filter in exec.ts. That is the whole reason this file is
// thin: a tool that reimplemented an operation would reimplement its guard too.

export interface McpTool {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations?: Record<string, boolean>;
  run: (a: Record<string, unknown>) => Promise<unknown>;
  /** Which audit action this writes, and which argument names the target. Reads
   *  are deliberately unaudited (bounded + high-volume, same rule the /api/v1
   *  routes follow); a tool without this field writes nothing.
   *
   *  This exists because MCP tools call lib/host DIRECTLY. The /api/v1 routes
   *  audit at the ROUTE layer, so without this every write, delete and exec that
   *  arrived over MCP would be invisible in the only forensic trail there is. */
  audit?: { action: AuditAction; targetArg?: string };
}

export const str = (a: Record<string, unknown>, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`${k} must be a non-empty string`);
  return v;
};
export const opt = (a: Record<string, unknown>, k: string): string | undefined =>
  typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined;

export const S = (properties: Record<string, unknown>, required?: string[]) =>
  ({ type: "object" as const, properties, ...(required ? { required } : {}) });

export const PATH_P = { path: { type: "string", description: "Absolute path on the VPS, or ~/… for the owner's home." } };
export const READ_ONLY = { readOnlyHint: true, idempotentHint: true };
