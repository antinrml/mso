import { describe, it, expect, afterEach } from "vitest";
import { parseScope, allows, mcpEnabled, maxScope, clampScope } from "./scope";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("parseScope", () => {
  it("defaults to least privilege for absent or unknown input", () => {
    expect(parseScope(undefined)).toBe("read");
    expect(parseScope("")).toBe("read");
    expect(parseScope("admin root sudo")).toBe("read");
  });

  it("takes the HIGHEST tier present, so a space-separated grant is not silently narrowed", () => {
    expect(parseScope("read write")).toBe("write");
    expect(parseScope("exec read")).toBe("exec");
    expect(parseScope("read,write,exec")).toBe("exec");
  });
});

describe("allows", () => {
  it("is a ladder — a higher tier implies every lower one", () => {
    expect(allows("exec", "read")).toBe(true);
    expect(allows("exec", "write")).toBe(true);
    expect(allows("write", "read")).toBe(true);
    expect(allows("read", "read")).toBe(true);
  });

  it("never lets a lower tier reach a higher one", () => {
    expect(allows("read", "write")).toBe(false);
    expect(allows("read", "exec")).toBe(false);
    expect(allows("write", "exec")).toBe(false); // the one that matters: no shell
  });
});

describe("mcpEnabled", () => {
  it("is OFF unless explicitly turned on", () => {
    delete process.env.OS_MCP_ENABLED;
    expect(mcpEnabled()).toBe(false);
    process.env.OS_MCP_ENABLED = "0";
    expect(mcpEnabled()).toBe(false);
    process.env.OS_MCP_ENABLED = "true"; // only "1" counts
    expect(mcpEnabled()).toBe(false);
    process.env.OS_MCP_ENABLED = "1";
    expect(mcpEnabled()).toBe(true);
  });

  it("stays off in demo mode even when enabled — demo has no login at all", () => {
    process.env.OS_MCP_ENABLED = "1";
    process.env.NEXT_PUBLIC_OS_DEMO = "1";
    expect(mcpEnabled()).toBe(false);
  });
});

describe("maxScope / clampScope", () => {
  it("defaults the ceiling to write, so shell access is opt-in twice", () => {
    delete process.env.OS_MCP_MAX_SCOPE;
    expect(maxScope()).toBe("write");
    expect(clampScope("exec")).toBe("write");
  });

  it("honours a lower ceiling", () => {
    process.env.OS_MCP_MAX_SCOPE = "read";
    expect(clampScope("exec")).toBe("read");
    expect(clampScope("write")).toBe("read");
  });

  it("lets exec through only when the deployment asks for it", () => {
    process.env.OS_MCP_MAX_SCOPE = "exec";
    expect(clampScope("exec")).toBe("exec");
    expect(clampScope("read")).toBe("read"); // never widens
  });

  it("falls back to write on a junk value rather than to exec", () => {
    process.env.OS_MCP_MAX_SCOPE = "root";
    expect(maxScope()).toBe("write");
  });
});
