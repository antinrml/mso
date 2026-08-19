import { describe, expect, it } from "vitest";
import type { McpTool } from "./tool-kit";
import { toolsetInfo } from "./toolset";

const tool = (name: string, description: string, scope: "read" | "write" | "exec" = "read"): McpTool => ({
  name, description, scope, inputSchema: { type: "object", properties: {} }, run: async () => "ok",
});

describe("MCP toolset signature", () => {
  it("is order-independent and reports exact scope counts", () => {
    const first = toolsetInfo([tool("b", "two", "exec"), tool("a", "one")]);
    const second = toolsetInfo([tool("a", "one"), tool("b", "two", "exec")]);
    expect(first.hash).toBe(second.hash);
    expect(first).toMatchObject({ toolCount: 2, byScope: { read: 1, write: 0, exec: 1 }, names: ["a", "b"] });
  });

  it("changes when a schema-relevant tool field changes", () => {
    expect(toolsetInfo([tool("a", "one")]).hash).not.toBe(toolsetInfo([tool("a", "changed")]).hash);
  });
});
