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
OS_MCP_MAX_SCOPE=exec    # optional: exec is the default; use read/write to opt down
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

Picked per token, on the consent screen, capped by `OS_MCP_MAX_SCOPE`. The highest allowed tier is preselected (`exec` on a default install); lower it before Allow when a client does not need full host access.

| Scope | Tools |
|---|---|
| `read` | `fs_list` `fs_read` `fs_search` `fs_usage` `sys_stats` `sys_processes` `apps_list` `apps_logs` `skills_search` `image_generation_status` `screen_capture` `browser_status` |
| `write` | + `workflow_start` `workflow_cancel` `workflow_finish` `fs_write` `fs_mkdir` `fs_move` `fs_copy` `fs_delete` `apps_power` |
| `exec` | + `image_generate` `exec_run` `browser_power` |

Alfa — the in-app assistant — has the same host capabilities under dot.case names,
and `lib/mcp/parity.test.ts` fails if one surface gains a tool the other lacks
without a written reason. `skills_search` maps to Alfa's `skills.search`.
`screen_capture`, `image_generation_status`, `image_generate`, `workflow_start`, `workflow_cancel` and `workflow_finish` are explicitly MCP-only:
the external connector needs visual proof and an actor-scoped task boundary, while
Alfa already runs inside the rendered shell and owns an in-app run boundary. The
two catalogs stay separate on purpose (different transport and guard) but may not
drift by accident.

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

## Toolset version, hash and action refresh

The catalog has a stable server version plus a schema-derived toolset signature. It is returned by public `GET /mcp`, MCP `initialize`, scoped `tools/list`, and the authenticated Settings → MCP endpoint. The signature changes when a name, description, input schema, scope, annotation or per-operation limit changes—not only when the tool count changes.

Settings → MCP shows the current version/hash/count and stores a browser-local acknowledgement when the operator marks ChatGPT refreshed. A later signature change becomes an explicit stale-snapshot warning. This does not mutate ChatGPT remotely; it makes the required refresh visible instead of relying on memory.

Current catalog: **24 tools**. `image_generation_status` and `image_generate` are the new public names in this release.

## Safe text inspection and overwrite

`fs_read` returns `content`, UTF-8 byte count and SHA-256. For an existing file, pass that digest as `fs_write.expected_sha256`; the write is refused if another process changed the file since inspection. Omitting it preserves create/legacy overwrite behaviour. Workflow memory stores the path, never the content or digest.

## Semantic skill search and learned workflows

MSO does not need to rediscover the same safe procedure on every conversation.
For a multi-step task, `workflow_start` is the **single bootstrap call**. It:

1. creates a unique exact-id run boundary;
2. searches trusted `SKILL.md` instructions, the current scoped MCP catalog and learned recipes;
3. resolves project paths and aliases such as `os-vps` → `mso`;
4. returns toolset version/hash/count, package metadata and bounded Git context;
5. recommends the closest successful recipe and execution policy.

Every operational tool advertises an optional `workflow_id`. Carry the exact id returned
by `workflow_start` on each step in that run. Multiple conversations may hold isolated
workflows in parallel on the same token. A call that omits the id is deliberately
standalone, and an unknown id is refused before the operation runs.

On approval, MSO returns the validated PKCE callback to the consent client, which uses
a top-level `location.replace()` rather than a nested Server Action redirect. This avoids
the confusing state where ChatGPT has already exchanged the code but the MSO tab remains
open. A setup started from ChatGPT Settings may still return to the app setup/tool-scan
surface rather than to the exact conversation that was open.

Use `skills_search` alone for capability research or an unfamiliar single-step task;
do not call it immediately before `workflow_start` for the same work. `workflow_finish`
requires the exact returned id and, after independent verification, records the redacted
sequence and merges semantically equivalent intents. `workflow_cancel` also requires the
exact id and abandons only that run without creating a recipe. A faster successful run
replaces the best path; a failed run remains evidence but never replaces a successful
recipe.

The index uses `mso-local-hybrid-v1`: a deterministic, local 384-dimensional
feature-hashed vector over words, bilingual aliases, bigrams and character n-grams,
combined with lexical overlap. It requires no API key, network call, model download
or token budget. This is a small local semantic router for MSO's skill/tool catalog,
not a general-purpose cloud embedding model. A future encoder can re-index recipes
because every saved vector carries its version.

Connected clients receive the bootstrap, terminal-batching, verification and visible-trace policy in MCP `initialize.instructions`:

```text
workflow_start → bounded tools or one scoped terminal batch → verify → workflow_finish
interrupted run → workflow_cancel with the exact workflow id
```

A recipe is guidance, not permission. The connector still checks current tool
availability, token scope, project context and safety constraints before reusing it.
Recipes that reference a missing or renamed tool are marked and ranked down.

From the browser or CLI:

```bash
mso skills list
mso skills read mso
mso skills search "deploy MSO and verify production"
```

The same search is available to Alfa as `skills.search` and through the
session-gated endpoint `GET /api/skills?q=...`.

## Creating a workflow skill

Use the committed template rather than copying an arbitrary `SKILL.md`:

```bash
bun run skill:new -- \
  --name mso-example \
  --description "Route a repeated MSO task through the smallest safe tools and verify the requested outcome." \
  --risk medium \
  --policy inspect-execute-verify \
  --title "Example Workflow"
bun run skill:check
```

The generator reads `templates/mso-skill-flow/SKILL.md.template`, writes only a new
`claude-skills/<name>/SKILL.md`, and refuses to overwrite an existing skill. The
template standardizes trigger boundaries, route selection, visible trace, verification,
rollback, approvals and recipe-memory hygiene. `mso-skill-authoring` is the trusted
playbook for completing and reviewing the generated file.

## Visual progress and secure temporary links

`screen_capture` renders only MSO itself — never an arbitrary URL — and can choose
`macos`, `windows` or `dashboard`. It returns the PNG directly to the MCP client plus
a temporary MSO preview/download URL. The artifact lives outside `public/`, requires
a valid approved-device session, uses an unguessable id, expires after 15 minutes,
is limited to five downloads, sends `Cache-Control: no-store`, and is deleted after
expiry/exhaustion. This provides visual progress without turning a read token into a
general browser or public-file-hosting primitive.

## Provider-backed image generation

`image_generation_status` is read-only and reports whether an OpenAI API key is
available without returning it. `image_generate` is exec-scope because it spends
provider credits, sends the prompt off-box, and writes binary bytes. Each call is
exactly one official OpenAI Images API request and produces:

- a lossless PNG master under `OS_IMAGE_OUTPUT_ROOT` (default `~/generated-images`);
- a prompt SHA-256 and byte SHA-256;
- actual provider model and `x-request-id` as the generation run identifier;
- width, height and alpha status parsed from the returned PNG;
- a 0600 provenance JSON sidecar that does not contain the raw prompt;
- a temporary authenticated preview when the image is at most 10 MiB.

Configure provider OpenAI in Settings → AI or set `OPENAI_API_KEY`. A ChatGPT
subscription/OAuth login is separate from API billing and is not silently reused.
Transparent requests automatically use `gpt-image-1.5` unless another compatible
model is explicitly selected; `gpt-image-2` is refused for transparent output.
Repository candidates are never written automatically—the generated PNG remains a
sandbox master until a project-specific validator/post-process promotes it.

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

MSO keeps two deliberately different records.

### Live MCP activity — operational visibility

Every MCP tool call, including reads, produces correlated `started` and terminal
(`completed`, `failed`, `denied`, `rate_limited`) rows in
`~/.mso/mcp-activity.log`. Workflow rows carry `workflowId`, intent and project, so
Assistant → MCP groups one task into a collapsible sequence instead of unrelated calls.
Each row renders a high-level feature badge/icon such as Skills, Files, Terminal, Git,
Build, Verify or Screenshot, plus status, duration and redacted target. This is an
execution trace, not private chain-of-thought. `fs_write.content`, file bodies, bearer
values and raw tool results are never stored.

View it in **Assistant → MCP** (live polling with pause/resume) or from the CLI:

```bash
mso mcp activity
mso mcp activity 100
```

### Security audit — forensic visibility

State-changing calls also land in the append-only security trail
`~/.mso/audit.log`, with `actor=mcp:<id>` matching Settings → MCP and
`mso mcp list`. The audit records `fs.write`, `fs.mkdir`, `fs.move`, `fs.copy`,
`fs.delete`, `exec.run`, `managed-app.action`, `camoufox.power`,
`workflow.start`, `workflow.cancel`, `workflow.finish`, and `mcp.denied`. It is intentionally quieter
than the activity stream so security-relevant lines are not buried by reads.

```bash
mso audit              # newest 50, everything
mso audit 100 exec.    # just command execution
mso audit 50 workflow. # learned workflow boundaries
mso audit 50 mcp.      # scope refusals
jq -c 'select(.actor|startswith("mcp:"))' ~/.mso/audit.log
```

A `read` connector repeatedly reaching for `exec_run` appears as `mcp.denied` and
is the prompt-injection signal worth watching. There is deliberately no MCP tool
for reading the security trail: a compromised token must not be able to check
whether the owner noticed it. The session-gated browser/CLI surfaces can read it.

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

`~/.mso/mcp.json`, mode 0600, is written atomically and holds **sha256 only** for
every authorization code and bearer. The raw value exists in flight and is handed
to the client exactly once. Authorization codes are single-use with a 60-second
TTL and are deleted before token minting.

Learned workflows live separately in `~/.mso/skill-memory.json` (override with
`OS_SKILL_MEMORY_STORE`), also mode 0600 under a 0700 directory and written by
atomic rename. It stores intent/summary, local semantic vectors, tool names, redacted targets and only
explicitly allowlisted scalar arguments, timings and outcomes. It does **not** store `fs_write.content`, raw file
contents, browser credentials, bearer tokens, API keys, or full secret-looking shell
arguments. The v2 store keeps up to 20 isolated active workflows per MCP actor, keyed by exact id; it migrates a live v1 actor workflow on read. Completed memory is bounded to 200 recipes. Each workflow retains at most 300 redacted evidence steps, while the reusable best path is compressed to at most 24 successful steps so exploratory reads and failed attempts are not taught back to the next run.

## Rate limits

Per token: 120 calls/min, 5,000/day. Per IP before auth: 240/min. DCR: 10
registrations/hour/IP. Token exchange: 30/min/IP. All in-memory (process-local,
resets on restart) — enough to blunt a runaway agent, which is the realistic
failure mode for an endpoint whose top scope is a shell.

Those are per TOKEN and say nothing about which tool ran, so each mutating tool
also carries the **per-operation** limit its route already applies, on the SAME
bucket key — MCP and the browser share one allowance rather than getting one each.
`exec_run` 60/min, fs writes 120/min, fs copy/delete 60/min, `apps_power` and
`browser_power` 12/min per app. MCP-native expensive/stateful operations are
stricter: `screen_capture` 10/min, `image_generate` 5/min, and workflow-memory writes 30/min.

## Layout

```
lib/mcp/pkce.ts           S256 verify, base64url, hashing, redirect_uri rules
lib/mcp/scope.ts          the read/write/exec ladder + the env kill switch
lib/mcp/store.ts          ~/.mso/mcp.json — clients, codes, tokens (hashed)
lib/mcp/tool-kit.ts       McpTool, direct image content and run context
lib/mcp/tools-read.ts     bounded reads + skills_search + screen_capture
lib/mcp/tools-learning.ts one-call bootstrap + start / cancel / finish
lib/mcp/toolset.ts        server/toolset version, schema hash and scoped manifest
lib/mcp/tools.ts          write/exec tools and the assembled catalog
lib/mcp/activity.ts       workflow-correlated live activity
lib/mcp/dispatch.ts       JSON-RPC, scope checks, metadata, activity + recipe capture
lib/host/projects.ts      bounded project resolution, aliases and repo context
lib/host/guarded-write.ts optimistic SHA-256 file overwrite guard
lib/skills/catalog.ts     trusted SKILL.md roots and provenance
lib/skills/semantic.ts    local hybrid embedding/search primitives
lib/skills/search.ts      unified skill/tool/recipe ranking
lib/skills/memory.ts      migrated multi-run exact-id workflow and recipe store
app/api/skills/route.ts   browser/Alfa list, read and semantic search
app/mcp/route.ts          bearer, rate limits and dispatch
app/oauth/*               authorize (consent) · token · register (DCR)
app/.well-known/*         RFC 9728 + RFC 8414 discovery
```

`/mcp` lives outside `/api` on purpose: `proxy.ts` blocks mutating `/api` that
cannot prove same-origin, and an MCP client is cross-origin by definition. The
CSRF gate is not the control here — the bearer is, and a browser never attaches
one on its own the way it does a cookie.
