import { audit } from "@/lib/host";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { allows, type Scope } from "./scope";

// JSON-RPC 2.0 dispatch for the MCP server. No SDK: the surface is initialize,
// ping, notifications/*, tools/list and tools/call, and hand-rolling it is far
// less code than adapting a transport we do not use.

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

// Newest version every shipping client still accepts. We echo the client's own
// version when it sends one, per the spec's negotiation rule.
const PROTOCOL = "2024-11-05";

export const UNAUTHORIZED = -32001;
export const RATE_LIMITED = -32029;

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string) =>
  ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** True for a JSON-RPC notification — no id, expects no response body. */
export function isNotification(body: unknown): boolean {
  const b = body as RpcRequest | null;
  return b?.id == null && String(b?.method ?? "").startsWith("notifications/");
}

function toolList(scope: Scope) {
  // Only advertise what this token can actually call. A tool listed but refused
  // on use makes the model retry the same dead call; not listing it makes the
  // model route around it, which is the behaviour we want from a read-only token.
  return TOOLS.filter((t) => allows(scope, t.scope)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
}

/**
 * @param actor identifies WHICH token acted, as `mcp:<id>` — the same id the
 *   Settings table and `mso mcp list` show, so a line in the trail maps back to a
 *   revoke button. Never the raw bearer.
 */
export async function dispatch(req: RpcRequest, scope: Scope, actor?: string): Promise<Record<string, unknown>> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mso", version: "1.0.0" },
      });
    case "notifications/initialized":
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList(scope) });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = req.params?.arguments ?? {};
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return fail(id, -32602, `unknown tool: ${name}`);
      // Scope is re-checked HERE, not just at tools/list — a client can call any
      // name it likes, and the list is only a hint.
      if (!allows(scope, tool.scope)) {
        // Logged even though nothing happened: a `read` connector repeatedly
        // reaching for exec_run is what a prompt-injected model looks like from
        // the outside, and it is the only place that signal is visible.
        void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: `scope ${scope} < ${tool.scope}` });
        return ok(id, {
          content: [{ type: "text", text: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}". Mint a new token in mso Settings → MCP.` }],
          isError: true,
        });
      }
      for (const k of tool.inputSchema.required ?? []) {
        if (args[k] == null) return fail(id, -32602, `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`);
      }
      // MCP tools call lib/host directly, so the ROUTE-level audit that covers
      // /api/v1 never runs for them. Without this, every write, delete and exec
      // that arrived over MCP would be missing from the one forensic trail there
      // is — and "revoke the token" is not much of a control if you cannot see
      // what it did first. Reads stay unaudited, same rule the routes follow.
      const trail = tool.audit;
      const target = trail?.targetArg != null ? String(args[trail.targetArg] ?? "") : undefined;
      try {
        const result = await tool.run(args);
        if (trail) {
          // `ok: true` used to be unconditional here, which made the trail lie about
          // the one tool that matters most: runCommand REFUSES a destructive command
          // by RETURNING code 126, so a blocked `rm -rf /` was recorded as a
          // successful exec.run, and `exec.blocked` could never be emitted over MCP.
          const o = trail.outcome?.(result);
          void audit({ action: o?.action ?? trail.action, actor, target, ok: o?.ok ?? true, detail: o?.detail, meta: { via: "mcp", scope } });
        }
        return ok(id, { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] });
      } catch (e) {
        // A handler failure stays INSIDE result with isError, never as a JSON-RPC
        // error object: ChatGPT hides protocol-level errors from the user, so the
        // person sees the model give up with no reason shown.
        const msg = e instanceof Error ? e.message : String(e);
        if (trail) void audit({ action: trail.action, actor, target, ok: false, detail: msg.slice(0, 200), meta: { via: "mcp", scope } });
        return ok(id, { content: [{ type: "text", text: "error: " + msg.slice(0, 500) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `unknown method: ${req.method}`);
  }
}

export { fail as rpcError };
