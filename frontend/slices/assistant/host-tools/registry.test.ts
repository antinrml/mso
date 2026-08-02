import { describe, expect, it } from "vitest";
import { HOST_TOOLS } from "./catalog";
import { findHostTool, HOST_AI_TOOLS } from "./registry";

// Pure-data test: no React / no shell (the catalog + registry only pull the
// schema helpers + type-only imports, so this runs in the node env).
describe("host-tools registry", () => {
  it("classifies reads as read; fs mutations + exec as mutate", () => {
    const eff = (n: string) => findHostTool(n)?.effect;
    for (const n of ["fs.list", "fs.read", "fs.search", "fs.usage", "sys.stats", "sys.processes", "apps.list", "skills.list", "skills.read", "memory.remember", "memory.forget"]) expect(eff(n)).toBe("read");
    for (const n of ["fs.write", "fs.mkdir", "fs.move", "fs.copy", "fs.delete", "exec.run"]) expect(eff(n)).toBe("mutate");
  });

  it("does NOT expose upload/browser/pty/app lifecycle in v1", () => {
    for (const n of ["fs.remove", "fs.upload", "browser.act", "pty.open", "apps.start", "apps.stop"])
      expect(findHostTool(n)).toBeUndefined();
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
