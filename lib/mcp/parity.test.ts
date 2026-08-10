import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

const { TOOLS } = await import("./tools");
const { HOST_TOOLS } = await import("@/frontend/slices/assistant/host-tools/catalog");

// THE GATE. Alfa and MCP are two catalogs on purpose — different transport,
// different guard (an approval card vs a scope tier), different handlers — and
// unifying them was considered and rejected: they share zero names, zero
// descriptions and zero handlers, so a shared registry would be an abstraction
// with two divergent consumers.
//
// What they must NOT do is drift by ACCIDENT, which is exactly what happened:
// MCP shipped apps_logs / apps_power / browser_status / browser_power and Alfa
// silently had less reach over the box than a remote ChatGPT connector, while
// Alfa's apps.list had been answering "no apps installed" for months. Nobody
// decided either one.
//
// So: every capability must appear in BOTH catalogs, or be listed below with a
// reason. Adding a tool to one surface alone fails this test until someone writes
// down why.

/** MCP is snake_case, Alfa is dot.case. Same capability, different convention. */
const capability = (name: string) => name.replace(/[._]/g, ".");

/** Deliberately one-sided, each with the reason. Keep this list SHORT — every
 *  entry is a place the two surfaces disagree, and a reader has to trust the
 *  reason. If a reason stops being true, delete the line and add the tool. */
const ALFA_ONLY: Record<string, string> = {
  "app.open": "openWindow is browser store state; an MCP client has no window to open",
  "skills.list": "the skill catalog is the assistant's own prompt furniture, not host control",
  "skills.read": "same — and /api/skills reads outside the fs jail, so it stays off a bearer-reached surface",
  "memory.remember": "writes into the owner's Alfa recall, which an MCP client does not share",
  "memory.forget": "same store; an MCP client has its own memory",
};

const MCP_ONLY: Record<string, string> = {};

describe("Alfa ↔ MCP capability parity", () => {
  const alfa = new Set(HOST_TOOLS.map((t) => capability(t.name)));
  const mcp = new Set(TOOLS.map((t) => capability(t.name)));

  it("every MCP tool has an Alfa counterpart, or a written reason", () => {
    const orphans = [...mcp].filter((c) => !alfa.has(c) && !(c in MCP_ONLY));
    expect(orphans, "add the tool to Alfa's catalog, or add it to MCP_ONLY with a reason").toEqual([]);
  });

  it("every Alfa tool has an MCP counterpart, or a written reason", () => {
    const orphans = [...alfa].filter((c) => !mcp.has(c) && !(c in ALFA_ONLY));
    expect(orphans, "add the tool to lib/mcp, or add it to ALFA_ONLY with a reason").toEqual([]);
  });

  it("the exemption lists name tools that still exist", () => {
    // A stale exemption is worse than none: it silently excuses a capability that
    // was renamed or deleted, and the gate stops covering it.
    for (const c of Object.keys(ALFA_ONLY)) expect(alfa, `ALFA_ONLY names ${c}`).toContain(c);
    for (const c of Object.keys(MCP_ONLY)) expect(mcp, `MCP_ONLY names ${c}`).toContain(c);
  });

  it("a capability that mutates on one surface mutates on the other", () => {
    // The guards differ (card vs scope) but the CLASSIFICATION must not: a tool
    // that parks an approval card in Alfa and sits in MCP's read tier would be
    // reachable with no human and no scope check at all.
    const alfaEffect = new Map(HOST_TOOLS.map((t) => [capability(t.name), t.effect]));
    for (const t of TOOLS) {
      const c = capability(t.name);
      const a = alfaEffect.get(c);
      if (!a) continue;
      const mcpMutates = t.scope !== "read";
      expect(mcpMutates, `${t.name} is ${t.scope} in MCP but ${a} in Alfa`).toBe(a === "mutate");
    }
  });
});

describe("MCP rate limits mirror the routes", () => {
  it("every mutating tool carries a per-operation limit", () => {
    // The token bucket in app/mcp/route.ts is per TOKEN and tool-blind, so without
    // this a write-scope token got 120/min on a daemon restart the UI limits to 12.
    for (const t of TOOLS) {
      if (t.scope === "read") continue;
      expect(t.limit?.max, `${t.name} has no limit — mirror its route's rateLimited()`).toBeGreaterThan(0);
    }
  });

  it("never grants more than the route it mirrors", () => {
    // Numbers lifted from the route files. The route is the authority; MCP may be
    // stricter, never laxer.
    const ROUTE_LIMITS: Record<string, number> = {
      "fs.write": 120, "fs.mkdir": 120, "fs.move": 120, "fs.copy": 60,
      "fs.delete": 60, "exec": 60, "managed-app": 12, "camoufox": 12,
    };
    for (const t of TOOLS) {
      if (!t.limit) continue;
      const route = ROUTE_LIMITS[t.limit.key];
      expect(route, `${t.name} limits on key "${t.limit.key}", which no route uses`).toBeDefined();
      expect(t.limit.max, `${t.name} allows more than its route`).toBeLessThanOrEqual(route);
    }
  });
});
