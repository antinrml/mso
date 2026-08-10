import { describe, it, expect, vi } from "vitest";
// The catalog reaches lib/camoufox + lib/managed-apps, which are `server-only`.
// Next aliases that specifier internally; vitest does not, so stub it — same
// pattern as lib/managed-apps/manager.test.ts.
vi.mock("server-only", () => ({}));
const { dispatch, isNotification } = await import("./dispatch");
const { TOOLS } = await import("./tools");

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("protocol", () => {
  it("echoes the client's protocolVersion when it sends one", async () => {
    const r = await dispatch({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "read");
    expect((r.result as Record<string, unknown>).protocolVersion).toBe("2025-06-18");
  });

  it("answers ping and initialized", async () => {
    expect(await dispatch({ id: 2, method: "ping" }, "read")).toMatchObject({ result: {} });
    expect(await dispatch({ id: 3, method: "notifications/initialized" }, "read")).toMatchObject({ result: {} });
  });

  it("returns a JSON-RPC error for an unknown method", async () => {
    const r = await dispatch({ id: 4, method: "tools/nope" }, "read");
    expect((r.error as { code: number }).code).toBe(-32601);
  });

  it("recognises notifications, which must be acked without a body", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/cancelled" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(false);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "notifications/initialized" })).toBe(false);
  });
});

describe("tools/list is scope-filtered", () => {
  const names = async (scope: "read" | "write" | "exec") => {
    const r = await dispatch({ id: 1, method: "tools/list" }, scope);
    return ((r.result as { tools: { name: string }[] }).tools).map((t) => t.name);
  };

  it("shows a read token only read tools", async () => {
    const n = await names("read");
    expect(n).toContain("fs_list");
    expect(n).toContain("sys_stats");
    expect(n).not.toContain("fs_write");
    expect(n).not.toContain("exec_run");
  });

  it("shows a write token everything but the shell", async () => {
    const n = await names("write");
    expect(n).toContain("fs_write");
    expect(n).toContain("fs_delete");
    expect(n).not.toContain("exec_run");
    expect(n).not.toContain("browser_power");
  });

  it("shows an exec token the whole catalog", async () => {
    expect(await names("exec")).toHaveLength(TOOLS.length);
  });
});

describe("tools/call enforces scope even when the tool was never listed", () => {
  it("refuses exec_run for a write token, and says how to fix it", async () => {
    const r = await dispatch(call("exec_run", { command: "id" }), "write");
    const res = r.result as { isError: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('needs "exec"');
    // NOT a JSON-RPC error — ChatGPT hides those from the user entirely.
    expect(r.error).toBeUndefined();
  });

  it("refuses fs_delete for a read token", async () => {
    const r = await dispatch(call("fs_delete", { path: "/tmp/x" }), "read");
    expect((r.result as { isError: boolean }).isError).toBe(true);
  });

  it("rejects an unknown tool name", async () => {
    expect((await dispatch(call("rm_rf_slash"), "exec")).error).toMatchObject({ code: -32602 });
  });

  it("rejects a call missing a required argument before running anything", async () => {
    expect((await dispatch(call("fs_read", {}), "read")).error).toMatchObject({ code: -32602 });
  });

  it("returns a handler failure as isError text, never as a protocol error", async () => {
    // Outside every read root → lib/host refuses. The point is the SHAPE.
    const r = await dispatch(call("fs_read", { path: "/proc/1/environ" }), "read");
    expect(r.error).toBeUndefined();
    expect((r.result as { isError?: boolean }).isError).toBe(true);
  });
});

describe("catalog hygiene", () => {
  it("every tool is snake_case and uniquely named", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("every required arg is declared in properties — a mismatch is unfixable by the model", () => {
    for (const t of TOOLS) {
      for (const k of t.inputSchema.required ?? []) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.${k}`).toContain(k);
      }
    }
  });

  it("read-scope tools are all annotated readOnlyHint, and no write tool claims it", () => {
    for (const t of TOOLS) {
      if (t.scope === "read") expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      else expect(t.annotations?.readOnlyHint, t.name).not.toBe(true);
    }
  });

  it("the irreversible tools carry destructiveHint so clients keep prompting", () => {
    for (const name of ["fs_delete", "exec_run", "browser_power"]) {
      expect(TOOLS.find((t) => t.name === name)?.annotations?.destructiveHint, name).toBe(true);
    }
  });
});
