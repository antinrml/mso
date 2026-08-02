import { clip, obj, str } from "./schema";
import { MUTATE_TOOLS } from "./catalog-mutate";
import type { HostTool } from "./types";


// Apps `app.open` refuses. Both mount a PTY on the host: claude-code auto-runs
// `claude --dangerously-skip-permissions` the moment its window appears, and
// os-terminal is a login shell. Neither passes through the approval card, and
// pty.ts states that keystrokes are unaudited and the destructive-command regex
// cannot reach them. registry.test.ts already keeps `pty.open` away from the
// model; this keeps the window that wraps it away too.
const SHELL_APPS = new Set(["claude-code", "os-terminal"]);

// The READ half. Mutating tools live in catalog-mutate.ts.
const READ_TOOLS: HostTool[] = [
  {
    name: "fs.list",
    group: "files",
    label: "List",
    effect: "read",
    description: "List a directory's entries (name, file/dir kind, size). Inspect before writing or moving.",
    parameters: obj({ "path!": str("Absolute directory path, e.g. /home/rahman/projects") }),
    run: async (api, a) => {
      const r = await api.fs.list(String(a.path));
      const body = r.entries.map((e) => `${e.kind === "dir" ? "d" : "-"} ${e.name}${e.kind === "file" ? ` (${e.size}b)` : ""}`).join("\n");
      return `${r.path}\n${body || "(empty)"}`;
    },
  },
  {
    name: "fs.read",
    group: "files",
    label: "Read",
    effect: "read",
    description: "Read a text file's contents (large files are truncated).",
    parameters: obj({ "path!": str("Absolute file path") }),
    run: async (api, a) => clip(await api.fs.read(String(a.path))),
  },
  {
    name: "fs.search",
    group: "files",
    label: "Search",
    effect: "read",
    description: "Find folders by name under ~/projects. Returns matching absolute paths.",
    parameters: obj({ "query!": str("Folder-name query") }),
    run: async (api, a) => {
      const hits = await api.fs.search(String(a.query));
      return hits.length ? hits.map((h) => h.path).join("\n") : "no matches";
    },
  },
  {
    name: "sys.stats",
    group: "system",
    label: "Stats",
    effect: "read",
    description: "Current host telemetry: CPU %, memory, disk, uptime.",
    parameters: obj({}),
    run: async (api) => {
      const s = await api.sys.stats();
      const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}GB`;
      return `CPU ${s.cpu.pct}% (${s.cpu.cores} cores) · mem ${gb(s.mem.used)}/${gb(s.mem.total)} · disk ${gb(s.disk.used)}/${gb(s.disk.total)} · up ${Math.floor(s.uptime / 3_600_000)}h`;
    },
  },
  {
    name: "sys.processes",
    group: "system",
    label: "Processes",
    effect: "read",
    description: "List running host processes with pid, name, status, CPU and memory.",
    parameters: obj({}),
    run: async (api) => {
      const ps = await api.sys.processes();
      return ps.length ? ps.slice(0, 30).map((p) => `${p.pid} ${p.name} ${p.status} cpu=${p.cpu} mem=${p.mem}`).join("\n") : "no process data";
    },
  },
  {
    name: "fs.usage",
    group: "files",
    label: "Disk usage",
    effect: "read",
    description: "Show writable filesystem roots and current usage.",
    parameters: obj({}),
    run: async (api) => {
      const u = await api.fs.usage();
      return `${Math.round(u.used / 1024 ** 2)}MiB used / ${Math.round(u.total / 1024 ** 2)}MiB total`;
    },
  },
  {
    name: "apps.list",
    group: "apps",
    label: "List apps",
    effect: "read",
    description: "List installed host apps (name + slug).",
    parameters: obj({}),
    run: async (api) => {
      const apps = await api.apps.list();
      return apps.length ? apps.map((x) => `${x.name} (${x.slug})`).join("\n") : "no apps installed";
    },
  },
  {
    // The one tool that makes Alfa visibly DRIVE MSO rather than just talk about
    // it: the window opens in front of the user, which is what "watch her move
    // between features" means. effect:"read" because opening a window in the
    // user's own cockpit changes nothing on the host — but that is only true
    // while SHELL_APPS below is enforced. Two apps break it: `claude-code` mounts
    // a PTY that immediately runs `claude --dangerously-skip-permissions`, and
    // `os-terminal` mounts a login shell. Either one would put a host shell on
    // screen through a tool that never parks an approval card, which is a way
    // around the whole mutate boundary — reachable by prompt injection, since the
    // app name comes from the model. They are refused here.
    name: "app.open",
    group: "apps",
    label: "Open app",
    effect: "read",
    description:
      "Open an MSO app window (files, browser, code, monitor, settings, assistant, hermes, openclaw, studio, reel, viewer, store, create, links). Use this to take the user to the app you are talking about instead of describing where it is. Terminals are not on this list on purpose — ask the user to open one.",
    parameters: obj({
      "app!": str("App id or slug, e.g. files, browser, terminal, monitor"),
      path: str("Optional payload for apps that accept one, e.g. a directory for files"),
    }),
    run: async (_api, args) => {
      const app = String(args.app ?? "").trim().toLowerCase();
      if (!app) throw new Error("app is required");
      const path = typeof args.path === "string" && args.path ? args.path : undefined;
      const { openWindow, BUILTIN_APPS } = await import("@/features/os-shell");

      // Resolve by slug OR id. The description advertises slugs (files, browser,
      // code…) but openWindow keys the registry by ID, and shell.manifest.ts gives
      // most apps a slug that differs from it. So the old `openWindow(app, app)`
      // rendered "Unknown app: files" for 12 of the 15 names it offered — and then
      // returned "opened files", telling the model and the user it had worked.
      // Same predicate as runtime/use-url-sync.tsx, so a URL and a tool call
      // resolve identically.
      const target = BUILTIN_APPS.find((a) => (a.slug ?? a.id) === app || a.id === app);
      if (!target) throw new Error(`unknown app "${app}"`);
      if (SHELL_APPS.has(target.id)) throw new Error(`"${app}" starts a shell on the host — open it yourself`);

      openWindow(target.id, target.title, target.defaultSize, path ? { path } : undefined);
      return `opened ${target.title}${path ? ` at ${path}` : ""}`;
    },
  },
  {
    name: "skills.list",
    group: "agent",
    label: "List skills",
    effect: "read",
    description: "List local MSO/OpenClaw/Codex skills available on this VPS. Use before asking to run a specialized skill such as camoufox.",
    parameters: obj({}),
    run: async () => {
      const data = (await fetch("/api/skills", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { skills: [] }))
        .catch(() => ({ skills: [] }))) as { skills?: { name: string; description?: string }[] };
      const skills = data.skills ?? [];
      return skills.length ? skills.map((s) => `${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n") : "no local skills found";
    },
  },
  {
    name: "skills.read",
    group: "agent",
    label: "Read skill",
    effect: "read",
    description: "Read one local skill's SKILL.md instructions by exact skill name.",
    parameters: obj({ "name!": str("Exact skill name from skills.list") }),
    run: async (_api, a) => {
      const name = String(a.name ?? "").trim();
      if (!name) return "missing skill name";
      const r = await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { cache: "no-store" });
      if (!r.ok) return `couldn't read skill ${name}`;
      const d = (await r.json()) as { content?: string; truncated?: boolean };
      return clip(`${d.content ?? ""}${d.truncated ? "\n… (truncated)" : ""}`);
    },
  },
  {
    name: "memory.remember",
    group: "agent",
    label: "Remember",
    effect: "read",
    description:
      "Save a durable fact about the user or their setup to long-term memory (recalled into future chats when relevant). Use it when the user states a lasting preference, fact, or instruction worth keeping — not for one-off task details.",
    parameters: obj({ "text!": str("The fact to remember — one concise sentence") }),
    run: async (_api, a) => {
      const text = String(a.text ?? "").trim();
      if (!text) return "nothing to remember (empty text)";
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return r.ok ? `remembered: ${text}` : "couldn't save the memory";
    },
  },
  {
    name: "memory.forget",
    group: "agent",
    label: "Forget",
    effect: "read",
    description:
      "Remove saved fact(s) from long-term memory. Give a short phrase describing what to forget; every remembered fact containing it is deleted. Use only when the user asks to forget or correct something.",
    parameters: obj({ "query!": str("A phrase identifying the fact(s) to forget") }),
    run: async (_api, a) => {
      const query = String(a.query ?? "").trim().toLowerCase();
      if (!query) return "nothing to forget (empty query)";
      const data = (await fetch("/api/memory", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { memories: [] }))
        .catch(() => ({ memories: [] }))) as { memories?: { id: string; text: string }[] };
      const hits = (data.memories ?? []).filter((m) => m.text.toLowerCase().includes(query));
      if (!hits.length) return `no saved memory matches "${a.query}"`;
      for (const m of hits) await fetch(`/api/memory?id=${encodeURIComponent(m.id)}`, { method: "DELETE" }).catch(() => {});
      return `forgot ${hits.length}: ${hits.map((m) => m.text).join("; ")}`;
    },
  },
];

// The catalog the rest of the app sees: read tools then mutate tools, one array.
export const HOST_TOOLS: HostTool[] = [...READ_TOOLS, ...MUTATE_TOOLS];
