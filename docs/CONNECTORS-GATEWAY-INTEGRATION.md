# mso → Connectors Gateway

**Status: mso is a registered connector there as of 2026-08-17** (`connectors-gateway@03e0948`).
Nothing in THIS repo changed to make that happen — no config, no code, no token. This
file exists so the next person here knows the dependency is there, because otherwise
it is invisible from inside mso.

Direction matters: mso is the **provider**. `rahmanef63/connectors-gateway` is a consumer
of mso's MCP surface, alongside CareerPack and Composio. It reaches mso the same way
ChatGPT or Claude.ai would — over `https://mso.rahmanef.com/mcp`, through the OAuth in
[`MCP.md`](./MCP.md). mso grants it nothing special.

## The thing that will break, and how

The gateway keeps its own manifest of mso's tools, and it pins **upstream tool names as
strings**:

```
connectors-gateway/adapters/remote-mcp/connectors/mso.connector.json
  { "id": "mso.fs.delete", …, "x-upstream": "fs_delete" }
```

There is no shared type, no generated client, and no build step that reads this repo.

**So renaming or removing a tool in `lib/mcp/tools.ts` or `tools-read.ts` breaks the
gateway silently.** Both repos still typecheck, both test suites still pass, and the
failure only shows up as one action erroring at call time for whoever is using it. The
same is true in reverse: a tool ADDED here does not appear in the gateway until someone
edits that JSON.

`lib/mcp/parity.test.ts` already guards the Alfa ↔ MCP axis. It does not know about this
one. If you rename a tool, grep the gateway repo for its name.

## What is exposed there, and what is deliberately not

15 of the 17 tools. The whole `read` and `write` tiers, and **neither `exec` tool**:

| Omitted | Why |
|---|---|
| `exec_run` | arbitrary shell on the VPS the gateway itself runs on |
| `browser_power` | drives the Camoufox profile holding live Google / LinkedIn sessions |

They are **omitted from the manifest, not disabled in policy**. That was decided in the
gateway's `docs/16-connector-strategy.md` before the connector was written: a disabled
action is one policy edit away from live, while a name absent from the catalog cannot be
resolved into an action id at all.

`connectors-gateway/adapters/remote-mcp/src/mso.test.ts` pins it, and checks `x-upstream`
rather than the local id — so renaming an action over there cannot smuggle the same shell
back in.

Two tools are rated `R3` + destructive there, which routes them through that platform's
human approval queue before they ever reach mso: **`fs_delete`** and **`apps_power`**. The
second one because stopping or restarting a daemon cuts off whatever is using it.

## Open decision — yours, not the gateway's

`.env.local` on the running box has:

```
OS_MCP_MAX_SCOPE=exec
```

`MCP.md`'s own example in this repo says `write`, and the gateway's `docs/16` says to
narrow it to `write` before connecting mso. It has **not** been changed — that is a
production config change to this application, so it is the owner's call rather than a
side effect of work done in another repo.

Narrowing it costs nothing for this integration: the gateway omits both `exec` tools, so
it never asks for that scope. What the ceiling protects against is a *different* token —
minted later, from the consent screen, by anyone who can sign in — being able to reach
`exec_run` at all.

## What was done in this repo: nothing

The gateway's manifest was written by reading `lib/mcp/tools.ts`, `lib/mcp/tools-read.ts`
and `lib/mcp/tool-kit.ts` directly, rather than by calling `tools/list` against the live
server. That was deliberate: it meant **no MCP bearer had to be minted on this deployment**
to build the integration. `mso mcp list` was empty before and is empty after.

## Checking it from here

```bash
mso mcp list          # tokens the gateway (or anything else) holds. Empty = not connected yet.
mso audit 50          # every mutating MCP call, actor `mcp:<id>`
```

The gateway side lives at `connectors-gateway/docs/16-connector-strategy.md` (why mso is
connected read/write only) and `docs/18-oauth.md` (how a client authorizes to that gateway
— unrelated to how the gateway authorizes to mso).
