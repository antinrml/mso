import {
  listDir, readFile, writeFile, makeDir, remove, move, copy, searchFs, usage,
  runCommand, stats, processes,
} from "@/lib/host";
import type { AuditAction } from "@/lib/host";
import { camoufoxStatus, setCamoufoxEnabled } from "@/lib/camoufox/service";
import { listManagedApps } from "@/lib/managed-apps/manager";
import type { Scope } from "./scope";

// The MCP tool catalog. EVERY handler goes through lib/host — never node fs or
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

const str = (a: Record<string, unknown>, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`${k} must be a non-empty string`);
  return v;
};
const opt = (a: Record<string, unknown>, k: string): string | undefined =>
  typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined;

const S = (properties: Record<string, unknown>, required?: string[]) =>
  ({ type: "object" as const, properties, ...(required ? { required } : {}) });

const PATH_P = { path: { type: "string", description: "Absolute path on the VPS, or ~/… for the owner's home." } };
const READ_ONLY = { readOnlyHint: true, idempotentHint: true };

export const TOOLS: McpTool[] = [
  {
    name: "fs_list",
    description:
      "List a directory on the VPS. Returns entries with name, type, size and mtime. " +
      "USE THIS FIRST to discover paths before reading or writing — guessing a path wastes a call. " +
      "Reads are bounded to OS_FS_READ_ROOTS and credential paths (~/.ssh, ~/.mso, cloud tokens) are refused.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({ ...PATH_P, includeHidden: { type: "boolean", description: "Include dotfiles. Default true." } }, ["path"]),
    run: (a) => listDir(str(a, "path"), a.includeHidden !== false),
  },
  {
    name: "fs_read",
    description:
      "Read a text file on the VPS and return its contents. For binary files this will be garbage — " +
      "check the extension from fs_list first. NOT for finding a file: use fs_search.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => ({ path: a.path, content: await readFile(str(a, "path")) }),
  },
  {
    name: "fs_search",
    description:
      "Find DIRECTORIES whose name contains a fragment, recursively, under a root. Use it to locate a " +
      "project folder before fs_list — it is bounded and needs no shell scope, unlike exec_run with find. " +
      "It does NOT match file names or file contents; fs_list the directory it returns.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({
      query: { type: "string", description: "Substring matched against directory names." },
      root: { type: "string", description: "Where to search from. Defaults to ~/projects." },
    }, ["query"]),
    run: (a) => searchFs(str(a, "query"), { root: opt(a, "root") }),
  },
  {
    name: "fs_usage",
    description: "Disk usage for a path: total, used and free bytes. Use for 'is the VPS full?'.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S(PATH_P, ["path"]),
    run: (a) => usage(str(a, "path")),
  },
  {
    name: "sys_stats",
    description:
      "Live VPS health: CPU load, memory, disk, uptime. USE THIS for 'how is the server doing' — " +
      "it is one cheap call and needs no shell scope.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: () => stats(),
  },
  {
    name: "sys_processes",
    description: "Top processes by CPU with pid, command, cpu% and memory%. Use to find what is eating the box.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: () => processes(),
  },
  {
    name: "apps_list",
    description:
      "List the managed applications mso can install and control on this VPS, with install and running state. " +
      "This is NOT the mso app list (Files, Terminal, …) — those are UI surfaces with no server state.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: () => listManagedApps(),
  },
  {
    name: "browser_status",
    description:
      "State of the Camoufox anti-fingerprinting browser (a real Firefox on a headless display). " +
      "Returns installed/running/autostart only. The viewer URL and its one-time VNC password are DELIBERATELY not " +
      "returned here — that session holds live Google and LinkedIn logins, so its credentials never leave " +
      "the box through a tool result. Open Settings in mso to get them.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: async () => {
      const s = await camoufoxStatus();
      return { installed: s.installed, running: s.running, autostart: s.enabled };
    },
  },

  {
    name: "fs_write",
    audit: { action: "fs.write" as const, targetArg: "path" },
    description:
      "Create or overwrite a text file on the VPS. Overwrites without warning — fs_read first if you need " +
      "the old contents. Bounded to OS_FS_WRITE_ROOTS (home + ~/projects by default).",
    scope: "write",
    annotations: { idempotentHint: true },
    inputSchema: S({ ...PATH_P, content: { type: "string" } }, ["path", "content"]),
    run: async (a) => {
      await writeFile(str(a, "path"), typeof a.content === "string" ? a.content : "");
      return { ok: true, path: a.path };
    },
  },
  {
    name: "fs_mkdir",
    audit: { action: "fs.mkdir" as const, targetArg: "path" },
    description: "Create a directory (and any missing parents) on the VPS.",
    scope: "write",
    annotations: { idempotentHint: true },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => { await makeDir(str(a, "path")); return { ok: true, path: a.path }; },
  },
  {
    name: "fs_move",
    audit: { action: "fs.move" as const, targetArg: "from" },
    description: "Move or rename a file or directory. Refuses when the source holds credential paths.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await move(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_copy",
    audit: { action: "fs.copy" as const, targetArg: "from" },
    description: "Copy a file or directory. The cockpit's own secrets are skipped rather than duplicated.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await copy(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_delete",
    audit: { action: "fs.delete" as const, targetArg: "path" },
    description:
      "Delete a file or directory on the VPS. PERMANENT — there is no trash and no undo. " +
      "Confirm with the user before calling this on anything you did not create in this conversation.",
    scope: "write",
    annotations: { destructiveHint: true },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => { await remove(str(a, "path")); return { ok: true, path: a.path }; },
  },

  {
    name: "exec_run",
    audit: { action: "exec.run" as const, targetArg: "command" },
    description:
      "Run a shell command on the VPS as the owner and return stdout, stderr and exit code. " +
      "FULL HOST POWER — prefer fs_* and sys_* tools whenever they cover the task; they are bounded and " +
      "this is not. Catastrophic patterns (rm -rf /, fork bombs, disk wipes) are refused by the server. " +
      "Long-running or interactive commands will time out: this is not a terminal session.",
    scope: "exec",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: S({
      command: { type: "string", description: "The shell command line to run." },
      cwd: { type: "string", description: "Working directory. Defaults to the owner's home." },
    }, ["command"]),
    run: (a) => runCommand(str(a, "command"), opt(a, "cwd")),
  },
  {
    name: "browser_power",
    audit: { action: "camoufox.power" as const, targetArg: "on" },
    description:
      "Start or stop the Camoufox browser session on the VPS. Starting boots a real Firefox on a headless " +
      "X display; the session self-terminates after 2h. Stop it when done — it holds a live logged-in profile.",
    scope: "exec",
    annotations: { destructiveHint: true },
    inputSchema: S({ on: { type: "boolean", description: "true = start, false = stop." } }, ["on"]),
    run: async (a) => {
      const s = await setCamoufoxEnabled(a.on === true);
      return { installed: s.installed, running: s.running, autostart: s.enabled };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
