import { clip, obj, str } from "./schema";
import type { HostTool } from "./types";

// The MUTATE half of the host catalog. Split from catalog.ts on the boundary that
// already governs everything else about these tools: every entry here parks an
// approval card and waits for a human before it touches the VPS, and none of the
// read tools do. Kept as one array so the approval policy has one place to look.
export const MUTATE_TOOLS: HostTool[] = [
  {
    name: "fs.write",
    group: "files",
    label: "Write",
    effect: "mutate",
    description: "Create or OVERWRITE a text file with the given contents. Overwrite is silent — read first if unsure.",
    parameters: obj({ "path!": str("Absolute file path"), "content!": str("Full new file contents") }),
    run: async (api, a) => {
      const content = String(a.content ?? "");
      await api.fs.write(String(a.path), content);
      return `wrote ${content.length} bytes to ${a.path}`;
    },
  },
  {
    name: "fs.mkdir",
    group: "files",
    label: "New folder",
    effect: "mutate",
    description: "Create a directory (parents included).",
    parameters: obj({ "path!": str("Absolute directory path to create") }),
    run: async (api, a) => {
      await api.fs.mkdir(String(a.path));
      return `created ${a.path}`;
    },
  },
  {
    name: "fs.move",
    group: "files",
    label: "Move",
    effect: "mutate",
    description: "Move or rename a file/dir to a full destination path.",
    parameters: obj({ "from!": str("Source path"), "to!": str("Destination path (full path, not just a dir)") }),
    run: async (api, a) => {
      await api.fs.move(String(a.from), String(a.to));
      return `moved ${a.from} → ${a.to}`;
    },
  },
  {
    name: "fs.copy",
    group: "files",
    label: "Copy",
    effect: "mutate",
    description: "Copy a file/dir to a full destination path. Read first if unsure.",
    parameters: obj({ "from!": str("Source path"), "to!": str("Destination path (full path, not just a dir)") }),
    run: async (api, a) => {
      await api.fs.copy(String(a.from), String(a.to));
      return `copied ${a.from} → ${a.to}`;
    },
  },
  {
    name: "fs.delete",
    group: "files",
    label: "Delete",
    effect: "mutate",
    description: "Delete a file/dir recursively within writable roots. High risk: inspect first.",
    parameters: obj({ "path!": str("Absolute file or directory path") }),
    run: async (api, a) => {
      await api.fs.remove(String(a.path));
      return `deleted ${a.path}`;
    },
  },
  {
    name: "exec.run",
    group: "terminal",
    label: "Run command",
    effect: "mutate",
    description: "Run a one-shot shell command on the VPS (30s cap, captured stdout/stderr, no PTY). Box-wrecking commands are refused by the server.",
    parameters: obj({ "cmd!": str("Shell command to run"), cwd: str("Working directory (optional; defaults to home)") }),
    run: async (api, a) => {
      const r = await api.exec.run(String(a.cmd), a.cwd ? String(a.cwd) : undefined);
      return clip(`exit ${r.code}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`);
    },
  },
];
