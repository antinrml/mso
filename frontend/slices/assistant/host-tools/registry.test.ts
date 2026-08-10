import { describe, expect, it } from "vitest";
import { HOST_TOOLS } from "./catalog";
import { findHostTool, HOST_AI_TOOLS } from "./registry";

// Pure-data test: no React / no shell (the catalog + registry only pull the
// schema helpers + type-only imports, so this runs in the node env).
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

  it("derives one AiTool per catalog tool with an object input_schema", () => {
    expect(HOST_AI_TOOLS).toHaveLength(HOST_TOOLS.length);
    for (const t of HOST_AI_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toMatchObject({ type: "object" });
    }
  });
});
