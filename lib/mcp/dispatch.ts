import { audit, rateLimited } from "@/lib/host";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { isMcpDirectResult } from "./tool-kit";
import { activityTarget, newActivityId, recordMcpActivity } from "./activity";
import { activeWorkflowForActor, recordWorkflowStep } from "@/lib/skills/memory";
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
        serverInfo: { name: "mso", version: "1.1.0" },
        instructions:
          "For a task likely to need two or more tool calls: call skills_search, then workflow_start before operational work, " +
          "reuse a relevant safe recipe, verify the result, and call workflow_finish so MSO retains the fastest successful path.",
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
      const activeWorkflow = await activeWorkflowForActor(actor);
      const workflowId = activeWorkflow?.id;
      // Scope is re-checked HERE, not just at tools/list — a client can call any
      // name it likes, and the list is only a hint.
      if (!allows(scope, tool.scope)) {
        // Logged even though nothing happened: a `read` connector repeatedly
        // reaching for exec_run is what a prompt-injected model looks like from
        // the outside, and it is the only place that signal is visible.
        void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: `scope ${scope} < ${tool.scope}` });
        const deniedId = newActivityId();
        const deniedTarget = activityTarget(args);
        void recordMcpActivity({ id: deniedId, actor, tool: name, state: "denied", scope, workflowId, target: deniedTarget, detail: `scope ${scope} < ${tool.scope}` });
        await recordWorkflowStep(actor, workflowId, { id: deniedId, tool: name, state: "denied", target: deniedTarget, args, ts: new Date().toISOString() });
        return ok(id, {
          content: [{ type: "text", text: `error: this token holds scope "${scope}"; ${name} needs "${tool.scope}". Mint a new token in mso Settings → MCP.` }],
          isError: true,
        });
      }
      for (const k of tool.inputSchema.required ?? []) {
        if (args[k] == null) return fail(id, -32602, `${name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`);
      }
      // The per-token bucket in app/mcp/route.ts does not know which tool ran, so
      // without this an MCP client could restart a daemon 120x/min while the UI and
      // the CLI share a 12/min bucket for the same operation. Deliberately the SAME
      // key the route uses, so the two share one bucket instead of getting one each.
      if (tool.limit) {
        const suffix = tool.limit.keyArg ? String(args[tool.limit.keyArg] ?? "") : (actor ?? "mcp");
        if (rateLimited(`${tool.limit.key}:${suffix}`, tool.limit.max, tool.limit.windowMs)) {
          void audit({ action: "mcp.denied", actor, target: name, ok: false, detail: "rate limited" });
          const limitedId = newActivityId();
          const limitedTarget = activityTarget(args);
          void recordMcpActivity({ id: limitedId, actor, tool: name, state: "rate_limited", scope, workflowId, target: limitedTarget, detail: "rate limited" });
          await recordWorkflowStep(actor, workflowId, { id: limitedId, tool: name, state: "rate_limited", target: limitedTarget, args, ts: new Date().toISOString() });
          return ok(id, {
            content: [{ type: "text", text: `error: ${name} is rate limited (${tool.limit.max} per ${Math.round(tool.limit.windowMs / 1000)}s). Wait and retry.` }],
            isError: true,
          });
        }
      }
      // MCP tools call lib/host directly, so the ROUTE-level audit that covers
      // /api/v1 never runs for them. Without this, every write, delete and exec
      // that arrived over MCP would be missing from the one forensic trail there
      // is — and "revoke the token" is not much of a control if you cannot see
      // what it did first. Reads stay unaudited, same rule the routes follow.
      const trail = tool.audit;
      const target = trail?.targetArg != null ? String(args[trail.targetArg] ?? "") : undefined;
      const activityId = newActivityId();
      const activityStarted = Date.now();
      const activityTgt = activityTarget(args);
      void recordMcpActivity({ id: activityId, actor, tool: name, state: "started", scope, workflowId, target: activityTgt });
      try {
        const result = await tool.run(args, { actor, scope, workflowId });
        if (trail) {
          // `ok: true` used to be unconditional here, which made the trail lie about
          // the one tool that matters most: runCommand REFUSES a destructive command
          // by RETURNING code 126, so a blocked `rm -rf /` was recorded as a
          // successful exec.run, and `exec.blocked` could never be emitted over MCP.
          const o = trail.outcome?.(result);
          void audit({ action: o?.action ?? trail.action, actor, target, ok: o?.ok ?? true, detail: o?.detail, meta: { via: "mcp", scope } });
        }
        const durationMs = Date.now() - activityStarted;
        void recordMcpActivity({ id: activityId, actor, tool: name, state: "completed", scope, workflowId, target: activityTgt, durationMs });
        await recordWorkflowStep(actor, workflowId, { id: activityId, tool: name, state: "completed", target: activityTgt, args, durationMs, ts: new Date().toISOString() });
        if (isMcpDirectResult(result)) return ok(id, { content: result.content, ...(result.isError ? { isError: true } : {}) });
        return ok(id, { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] });
      } catch (e) {
        // A handler failure stays INSIDE result with isError, never as a JSON-RPC
        // error object: ChatGPT hides protocol-level errors from the user, so the
        // person sees the model give up with no reason shown.
        const msg = e instanceof Error ? e.message : String(e);
        if (trail) void audit({ action: trail.action, actor, target, ok: false, detail: msg.slice(0, 200), meta: { via: "mcp", scope } });
        const durationMs = Date.now() - activityStarted;
        void recordMcpActivity({ id: activityId, actor, tool: name, state: "failed", scope, workflowId, target: activityTgt, durationMs, detail: msg.slice(0, 220) });
        await recordWorkflowStep(actor, workflowId, { id: activityId, tool: name, state: "failed", target: activityTgt, args, durationMs, ts: new Date().toISOString() });
        return ok(id, { content: [{ type: "text", text: "error: " + msg.slice(0, 500) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `unknown method: ${req.method}`);
  }
}

export { fail as rpcError };
