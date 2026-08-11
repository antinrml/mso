import { writeFile, makeDir, remove, move, copy, runCommand } from "@/lib/host";
import { setCamoufoxEnabled } from "@/lib/camoufox/service";
import { performManagedAppAction } from "@/lib/managed-apps/manager";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { MANAGED_APP_ACTIONS, type ManagedAppAction } from "@/lib/managed-apps/types";
import { type McpTool, str, opt, S, PATH_P } from "./tool-kit";
import { READ_TOOLS } from "./tools-read";

// The write and exec tiers. Each carries an `audit` descriptor — the dispatcher,
// not the tool, writes the trail, because these call lib/host directly and so
// never pass the route-layer audit that covers /api/v1.
const MUTATE_TOOLS: McpTool[] = [
  {
    name: "fs_write",
    limit: { key: "fs.write", max: 120, windowMs: 60_000 },
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
    limit: { key: "fs.mkdir", max: 120, windowMs: 60_000 },
    audit: { action: "fs.mkdir" as const, targetArg: "path" },
    description: "Create a directory (and any missing parents) on the VPS.",
    scope: "write",
    annotations: { idempotentHint: true },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => { await makeDir(str(a, "path")); return { ok: true, path: a.path }; },
  },
  {
    name: "fs_move",
    limit: { key: "fs.move", max: 120, windowMs: 60_000 },
    audit: { action: "fs.move" as const, targetArg: "from" },
    description: "Move or rename a file or directory. Refuses when the source holds credential paths.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await move(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_copy",
    limit: { key: "fs.copy", max: 60, windowMs: 60_000 },
    audit: { action: "fs.copy" as const, targetArg: "from" },
    description: "Copy a file or directory. The cockpit's own secrets are skipped rather than duplicated.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await copy(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_delete",
    limit: { key: "fs.delete", max: 60, windowMs: 60_000 },
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
    name: "apps_power",
    limit: { key: "managed-app", max: 12, windowMs: 60_000, keyArg: "id" },
    audit: { action: "managed-app.action" as const, targetArg: "id" },
    description:
      "Start, stop, restart or back up a managed application on the VPS. Bounded to the known apps and " +
      "those four verbs — restarting a daemon should not require handing over a shell, so this sits at " +
      "write scope rather than exec. Check apps_list or apps_logs first.",
    scope: "write",
    annotations: { destructiveHint: true },
    // The verb list is READ from MANAGED_APP_ACTIONS, never retyped. It was retyped,
    // and `backup` — a real action with a real route, taken automatically before
    // every update — was missing from the enum AND from the guard below, so an MCP
    // client could not take one and was told the tool only did three things.
    inputSchema: S({
      id: { type: "string", description: "Managed app id from apps_list." },
      action: { type: "string", enum: [...MANAGED_APP_ACTIONS], description: MANAGED_APP_ACTIONS.join(" | ") },
    }, ["id", "action"]),
    run: (a) => {
      const id = str(a, "id");
      const action = str(a, "action");
      if (!isManagedAppId(id)) throw new Error(`unknown managed application "${id}" — call apps_list for valid ids`);
      if (!(MANAGED_APP_ACTIONS as readonly string[]).includes(action))
        throw new Error(`action must be one of ${MANAGED_APP_ACTIONS.join(", ")}`);
      // `{ app }`, matching POST /api/v1/managed-apps/[id]. Same capability, same
      // envelope — a client that learned the shape from the CLI or the route must
      // not have to learn a second one here.
      return performManagedAppAction(id, action as ManagedAppAction).then((app) => ({ app }));
    },
  },
  {
    name: "exec_run",
    limit: { key: "exec", max: 60, windowMs: 60_000 },
    audit: {
      action: "exec.run" as const,
      targetArg: "command",
      // runCommand REFUSES by returning {code:126, stderr:"refused: …"}, it does not
      // throw — so "the handler did not throw" is not success here. Mirrors
      // app/api/v1/exec/run/route.ts:39-45 exactly; the two must not disagree about
      // what the same command did.
      outcome: (r) => {
        const { code, stderr } = r as { code: number; stderr: string };
        const blocked = code === 126 && stderr.startsWith("refused:");
        return { ok: !blocked && code === 0, action: blocked ? "exec.blocked" : "exec.run", detail: `exit ${code}` };
      },
    },
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
    limit: { key: "camoufox", max: 12, windowMs: 60_000 },
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

export const TOOLS: McpTool[] = [...READ_TOOLS, ...MUTATE_TOOLS];
export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export type { McpTool } from "./tool-kit";
