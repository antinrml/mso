# MCP — drive this VPS from ChatGPT, Claude.ai or Cursor

mso ships an MCP server so an AI client can call the same host operations the web
UI does: list and read files, write them, check CPU/memory/disk, list processes and
managed apps, and — if you grant it — run shell commands.

It is **off by default**. While `OS_MCP_ENABLED` is unset, `/mcp` and both OAuth
discovery documents return 404. There is no MCP surface at all, not an
unauthenticated one.

## Turn it on

```bash
# .env.local
OS_MCP_ENABLED=1
OS_MCP_MAX_SCOPE=write   # read | write | exec — the ceiling the consent screen may grant
```

Then `bun run build && sudo systemctl restart mso.service` (build THEN restart —
see CLAUDE.md's deploy hazard).

## Connect ChatGPT

Settings → Connectors → New App. Every field is copy-pasteable from
**mso → Settings → MCP**.

| Field | Value |
|---|---|
| MCP Server URL | `https://mso.rahmanef.com/mcp` |
| Authentication | `OAuth` |
| Registration method | `User-Defined OAuth Client` |
| Client ID | `chatgpt-mso` (any string) |
| Client Secret | *empty* |
| Token endpoint auth method | `none` |
| Auth URL | `https://mso.rahmanef.com/oauth/authorize` |
| Token URL | `https://mso.rahmanef.com/oauth/token` |
| Resource | `https://mso.rahmanef.com/mcp` |

Clicking Create sends you to mso's consent screen. **You must already be signed in
to mso on that device** — the consent page cannot authorize anything on its own;
it converts an existing approved session into a bearer.

Claude.ai, Cursor and `mcp-remote` register themselves through RFC 7591 DCR — give
them the MCP Server URL and nothing else.

Verify discovery before you click Create:

```bash
curl -s https://mso.rahmanef.com/.well-known/oauth-protected-resource | jq
curl -s https://mso.rahmanef.com/.well-known/oauth-authorization-server | jq
```

A 404 there is the cause of ChatGPT's unhelpful "MCP server does not implement
OAuth" — it means `OS_MCP_ENABLED` is not set on the running process.

## The three scopes

Picked per token, on the consent screen, capped by `OS_MCP_MAX_SCOPE`.

| Scope | Tools |
|---|---|
| `read` | `fs_list` `fs_read` `fs_search` `fs_usage` `sys_stats` `sys_processes` `apps_list` `apps_logs` `browser_status` |
| `write` | + `fs_write` `fs_mkdir` `fs_move` `fs_copy` `fs_delete` `apps_power` |
| `exec` | + `exec_run` `browser_power` |

Alfa — the in-app assistant — has the same capabilities under dot.case names, and
`lib/mcp/parity.test.ts` fails if one surface gains a tool the other lacks without a
written reason. The two catalogs stay separate on purpose (different transport,
different guard) but may not drift by accident, which they did: MCP shipped the
managed-app and browser tools before Alfa had them.

**These tool names are also a cross-repo contract.** `rahmanef63/connectors-gateway`
registered mso as a connector on 2026-08-17 and pins 15 of these names as strings; a
rename here breaks it with no error in either repo, and `parity.test.ts` does not cover
that axis. See [`CONNECTORS-GATEWAY-INTEGRATION.md`](./CONNECTORS-GATEWAY-INTEGRATION.md)
before renaming or removing a tool.

The tiering is about blast radius, not about which layer the call lands in.
`apps_logs` reads a daemon's journal, so "why is hermes down?" is answerable from
a `read` token — the same question through `exec_run` would need a full shell.
`apps_power` is four verbs (start, stop, restart, backup) against known units, so
restarting a daemon does not require handing one over either.

`tools/list` is filtered by the token's scope, and `tools/call` re-checks it — a
client that calls a tool it was never shown still gets refused.

## What this does and does not protect

Every tool goes through `lib/host`, so the MCP surface inherits the bounds that
already guard `/api/v1`:

- `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`
- the credential denylist — `~/.ssh`, `~/.gnupg`, cloud and AI tokens, and `~/.mso`
  itself, so a read tool cannot exfiltrate the device allowlist, the BYOK key or
  the browser profile's cookies
- realpath escape checks on every path
- the catastrophic-command filter in `lib/host/exec.ts` (`rm -rf /`, fork bombs,
  disk wipes)

The Camoufox viewer URL and its one-time VNC password are deliberately **not**
returned by `browser_status`. That profile holds a live Google session; its
credentials never leave the box through a tool result.

**What it does not protect against, and you should decide with open eyes:**

- A bearer is a standing credential. Anyone who obtains it has your scope until you
  revoke it. Tokens expire after 90 days; that is a backstop, not a control.
- At `exec` scope, that means arbitrary commands on this VPS as you.
- Every tool call and its result goes to the client's provider. At `read` scope
  that is file contents; at `exec` scope it is command output.
- Prompt injection is real here: content the model READS (a file, a log line, a
  web page it was told to fetch) can try to talk it into calling a write or exec
  tool. Scope is the containment — a `read` token cannot be talked into `rm`.

Grant `read` unless you actually need more, and mint a second token when you do.

## Seeing what a token did

Revoking is a weak control if you cannot see what already went through, so every
mutating MCP call lands in the same audit trail (`~/.mso/audit.log`, JSONL) that
the web UI's writes and commands do — with `actor` set to `mcp:<id>`, the same id
the Settings table and `mso mcp list` show.

```bash
mso audit              # newest 50, everything
mso audit 100 exec.    # just command execution
mso audit 50 mcp.      # just scope refusals
jq -c 'select(.actor|startswith("mcp:"))' ~/.mso/audit.log   # everything MCP did
```

Settings → MCP shows the last 20 MCP lines inline.

What is recorded: `fs.write` `fs.mkdir` `fs.move` `fs.copy` `fs.delete`
`exec.run` `managed-app.action` `camoufox.power`, each with its target and whether it succeeded, plus
`mcp.denied` when a token asks for a tool above its scope. **That last one is the
signal worth watching** — a `read` connector repeatedly reaching for `exec_run` is
what a prompt-injected model looks like from the outside.

Reads are NOT recorded. Same rule the `/api/v1` routes follow: they are bounded
and high-volume, and logging them would bury the lines that matter.

There is deliberately no MCP tool for reading the trail. It records what every
token did; letting a token read it would let a compromised one check whether it
had been noticed. `GET /api/v1/sys/audit` is session-gated, browser and CLI only.

## Revoking

**mso → Settings → MCP**, or from the CLI:

```bash
mso mcp list
mso mcp revoke <id>
mso mcp revoke all      # panic button
```

Revocation is immediate: the token is re-validated on every single call, so an
in-flight connector stops on its next request.

## Storage

`~/.mso/mcp.json`, mode 0600, written atomically. It holds **sha256 only** — of
every authorization code and every bearer. The raw value exists in flight and is
handed to the client exactly once. A stolen copy of that file tells an attacker
what was issued, not how to use it.

Authorization codes are single-use with a 60-second TTL and are deleted before the
token is minted, so a replayed code finds nothing and gets `invalid_grant`.

## Rate limits

Per token: 120 calls/min, 5,000/day. Per IP before auth: 240/min. DCR: 10
registrations/hour/IP. Token exchange: 30/min/IP. All in-memory (process-local,
resets on restart) — enough to blunt a runaway agent, which is the realistic
failure mode for an endpoint whose top scope is a shell.

Those are per TOKEN and say nothing about which tool ran, so each mutating tool
also carries the **per-operation** limit its `/api/v1` route already applies, on
the SAME bucket key — MCP and the browser share one allowance rather than getting
one each. `exec_run` 60/min, fs writes 120/min, fs copy/delete 60/min,
`apps_power` and `browser_power` 12/min per app. Without this a write-scope token
could restart a daemon 120×/min while the UI was capped at 12.

## Layout

```
lib/mcp/pkce.ts       S256 verify, base64url, hashing, redirect_uri rules
lib/mcp/scope.ts      the read/write/exec ladder + the env kill switch
lib/mcp/store.ts      ~/.mso/mcp.json — clients, codes, tokens (hashed)
lib/mcp/tool-kit.ts   the McpTool shape + arg helpers shared by both tiers
lib/mcp/tools-read.ts the read tier — observability, no way to change anything
lib/mcp/tools.ts      the write + exec tiers, and the assembled catalog
lib/mcp/dispatch.ts   JSON-RPC: initialize / ping / tools.list / tools.call
app/mcp/route.ts      the endpoint — bearer, rate limits, dispatch
app/oauth/*           authorize (consent) · token · register (DCR)
app/.well-known/*     RFC 9728 + RFC 8414 discovery
```

`/mcp` lives outside `/api` on purpose: `proxy.ts` blocks mutating `/api` that
cannot prove same-origin, and an MCP client is cross-origin by definition. The
CSRF gate is not the control here — the bearer is, and a browser never attaches
one on its own the way it does a cookie.
