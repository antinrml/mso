import { describe, expect, it } from "vitest";
// Still the os-terminal BARREL, spelled the long way: vitest.config.mts lists the
// `@` alias before `@/features`, so `@/features/os-terminal` resolves to
// <root>/features and fails to load under vitest only. Same workaround as
// lib/mcp/parity.test.ts.
import { claudeCodeApp, osTerminalApp } from "@/frontend/slices/os-terminal";
import { HOST_TOOLS, SHELL_APPS } from "./catalog";
import { findHostTool, HOST_AI_TOOLS } from "./registry";

// Runs in the node env: the catalog + registry pull only the schema helpers and
// type-only imports. The one exception is that barrel, imported for the two
// AppDescriptors below — it is `lazy()` + icons and touches no DOM, which is the
// only reason it is safe here. Do not reach for the shell barrel to get
// BUILTIN_APPS instead; that drags the whole window runtime into a data test.
describe("host-tools registry", () => {
  it("classifies reads as read; fs mutations + exec as mutate", () => {
    const eff = (n: string) => findHostTool(n)?.effect;
    for (const n of ["fs.list", "fs.read", "fs.search", "fs.usage", "sys.stats", "sys.processes", "apps.list", "apps.logs", "browser.status", "skills.list", "skills.read", "memory.remember"]) expect(eff(n)).toBe("read");
    for (const n of ["fs.write", "fs.mkdir", "fs.move", "fs.copy", "fs.delete", "exec.run", "memory.forget", "apps.power", "browser.power"]) expect(eff(n)).toBe("mutate");
  });

  it("memory.forget parks a card; memory.remember does not", () => {
    // Asymmetric on purpose. remember ADDS one line and the owner can delete it.
    // forget deletes EVERY fact containing a substring, rewrites the file with no
    // backup, and cannot be undone — so one injected "forget everything" is
    // availability loss unless a human sees the card first.
    expect(findHostTool("memory.forget")?.effect).toBe("mutate");
    expect(findHostTool("memory.remember")?.effect).toBe("read");
  });

  it("does NOT expose upload or PTY — a decision, not a backlog", () => {
    // These stay off the model's list for reasons that still hold, and both are
    // written down: multipart bytes are not a thing a model can produce
    // (catalog.ts), and PTY keystrokes are neither audited nor reachable by the
    // destructive-command filter. `fs.remove` is the old name of fs.delete.
    for (const n of ["fs.remove", "fs.upload", "pty.open"]) expect(findHostTool(n)).toBeUndefined();
  });

  it("app.open advertises no app that opens a host shell", () => {
    // Keeping pty.open away from the model buys nothing if a window that mounts a
    // PTY is one app.open away: claude-code runs `claude --dangerously-skip-permissions`
    // on mount, os-terminal is a login shell, and neither passes an approval card.
    // The name comes from the model, so prompt injection reaches this. run() refuses
    // both by id; this pins the description so they are not advertised either.
    const open = findHostTool("app.open");
    expect(open?.effect).toBe("read");
    for (const shell of ["terminal", "claude-code", "claude code", "shell"])
      expect(open?.description.toLowerCase()).not.toContain(shell + ",");
    expect(open?.description).toMatch(/Terminals are not on this list/);
  });

  it("SHELL_APPS still names the two apps that actually mount a PTY", () => {
    // The guard in catalog.ts compares app.open's argument to STRING ids. Nothing
    // else connects those strings to the descriptors they refer to, so renaming
    // `claude-code` or `os-terminal` in the os-terminal barrel would leave the set
    // matching nothing — app.open would open a window that auto-runs
    // `claude --dangerously-skip-permissions`, from a READ-tier tool that parks no
    // approval card, and this whole file would still be green. The set equality is
    // the guard; the two literals are the pin, so even a correctly-synced rename
    // has to come through here on purpose.
    expect(osTerminalApp.id).toBe("os-terminal");
    expect(claudeCodeApp.id).toBe("claude-code");
    expect([...SHELL_APPS].sort()).toEqual([claudeCodeApp.id, osTerminalApp.id].sort());
  });

  it("derives one AiTool per catalog tool with an object input_schema", () => {
    expect(HOST_AI_TOOLS).toHaveLength(HOST_TOOLS.length);
    for (const t of HOST_AI_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toMatchObject({ type: "object" });
    }
  });
});
