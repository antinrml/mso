import { listDir, readFile, searchFs, usage, stats, processes, captureMsoScreen } from "@/lib/host";
import { camoufoxStatus } from "@/lib/camoufox/service";
import { listManagedApps, getManagedAppLogs } from "@/lib/managed-apps/manager";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { type McpTool, str, opt, S, PATH_P, READ_ONLY, mcpDirect } from "./tool-kit";

// The read tier: observability with no way to change anything. Everything here is
// answerable without granting a shell, which is the whole point of the tiering —
// "why is hermes down?" should not cost the same trust as `exec_run`.
export const READ_TOOLS: McpTool[] = [
  {
    name: "fs_list",
    description:
      "List a directory on the VPS. Returns entries with name and type. Size is reported as 0 for " +
      "every entry and is NOT a real size — never conclude a file is empty from it. " +
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
    // `{ apps: [...] }`, not a bare array — GET /api/v1/managed-apps is the authority
    // on this shape and `mso mapp list` already prints its envelope. Returning the
    // array raw meant one capability answered in two shapes depending on which
    // surface asked, which is exactly the drift the parity gate exists to stop.
    run: async () => ({ apps: await listManagedApps() }),
  },
  {
    name: "apps_logs",
    description:
      "Recent log output for a managed application (hermes, openclaw). USE THIS to answer 'why is X " +
      "down' — it needs only read scope, where the same question via exec_run would need a full shell. " +
      "Call apps_list first for the valid ids and their state.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({ id: { type: "string", description: "Managed app id from apps_list, e.g. hermes." } }, ["id"]),
    run: (a) => {
      const id = str(a, "id");
      if (!isManagedAppId(id)) throw new Error(`unknown managed application "${id}" — call apps_list for valid ids`);
      return getManagedAppLogs(id);
    },
  },
  {
    name: "screen_capture",
    description:
      "Capture the authenticated MSO desktop and return it as an image. This is intentionally limited to " +
      "MSO itself (no arbitrary URL capture), so it can be used to show visual progress without turning a read token " +
      "into a browser exfiltration primitive. Choose macos, windows or dashboard; default macos.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "screen.capture", max: 10, windowMs: 60_000 },
    inputSchema: S({
      shell: { type: "string", enum: ["macos", "windows", "dashboard"], description: "Desktop shell to render. Default macos." },
      width: { type: "number", minimum: 900, maximum: 1920, description: "Viewport width. Default 1440." },
      height: { type: "number", minimum: 600, maximum: 1200, description: "Viewport height. Default 900." },
    }),
    run: async (a) => {
      const shell = typeof a.shell === "string" && ["macos", "windows", "dashboard"].includes(a.shell)
        ? (a.shell as "macos" | "windows" | "dashboard")
        : "macos";
      const shot = await captureMsoScreen({
        shell,
        width: typeof a.width === "number" ? a.width : undefined,
        height: typeof a.height === "number" ? a.height : undefined,
      });
      return mcpDirect([
        { type: "image", data: shot.data, mimeType: shot.mimeType },
        { type: "text", text: `MSO ${shot.shell} screenshot — ${shot.width}×${shot.height}` },
      ]);
    },
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
];
