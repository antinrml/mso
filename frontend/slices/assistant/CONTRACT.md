# The Alfa contract

What an **Agent**, a **Playbook**, a **Tool** and a **Skill** each are in MSO, where
the single source of truth for each lives, and what actually reaches the model.

Written because four of these had drifted into fiction: a 45-entry tool catalog the
model could never call, agent tool-scoping that configured nothing, and two
unrelated things both called "skill".

---

## Tool

**An operation the model can actually invoke.** If it is not here, the model cannot
do it — there is no second list.

| | |
|---|---|
| Shape | `HostTool` — `frontend/slices/assistant/host-tools/types.ts` |
| Source of truth | `host-tools/catalog.ts` (read) + `catalog-mutate.ts` (mutate) → `HOST_TOOLS` |
| Lifecycle | Static array, compiled in |
| Written by | Developers only |

Every tool declares `effect`:

- **`read`** — runs immediately.
- **`mutate`** — parks an approval card and waits for a human before touching the
  VPS. The rendezvous is `appshell/lib/alfa-approvals.ts`, so *any* surface showing
  the card can answer it (the Assistant app, the desktop dock, the mobile sheet).

`group` and `label` are presentation only and are never sent to the model.

`OS_TOOLS` (`lib/tools.ts`) is a **view** of `HOST_TOOLS` for the pickers. It is
derived, never authored. `lib/tools.test.ts` fails if the two ever diverge.

## Playbook (the localStorage `Skill` type)

**A named bundle of instructions a user assembles.** Shown in the Assistant's
Skills tab.

| | |
|---|---|
| Shape | `Skill` — `lib/types.ts` |
| Source of truth | `localStorage["alfa.skills"]`, seeded from `PRESET_SKILLS` |
| Lifecycle | Per browser, user-editable |
| Written by | The user, via the Skills tab |

Tool ids are MIGRATED on read (`lib/store.ts` `migrateRows`), not dropped: a bundle
saved before the catalogs converged has its old ids mapped to the current ones, and
only ids that never had an executable counterpart are removed. Dropping instead of
mapping would have emptied the five builtin bundles for every existing install —
`store-migration.test.ts` is what holds that line.

> **Naming.** This type is called `Skill` in code and "Skills" in the UI, which
> collides with the unrelated concept below. The rename is **Playbook**, not
> "Toolset": once scoping is deleted a bundle grants no tools, so "Toolset" would
> just be the next false name. Not done yet — see Known gaps.

## Skill (a `SKILL.md` on disk)

**A markdown playbook on the host.** Nothing to do with the type above: different
shape, different storage, different lifecycle, and the names do not overlap.

| | |
|---|---|
| Shape | `{ name, path, description }` — `app/api/skills/route.ts` |
| Source of truth | `GET /api/skills` — repo `skills/` first, then host roots |
| Lifecycle | Files on disk |
| Written by | Whoever installs skills on the box |

The model reaches these through the `skills.list` and `skills.read` **tools**. That
is also what `/skill` in the composer does: it inserts a directive naming the skill,
and Alfa reads it with the tool she already has. There is no separate execution path.

## Agent

**A persona.** Currently that, and only that.

| | |
|---|---|
| Shape | `Agent` — `lib/types.ts` |
| Source of truth | `lib/store.ts` — a MODULE store over `localStorage["alfa.agents"]` |
| Lifecycle | Per browser, user-editable |
| Written by | The user, via the Agents tab or an `@mention` pick |

The store is module-level (same shape as `appshell/lib/alfa.ts`), so the Alfa sheet
and the desktop dock can read and switch the agent without the Assistant app being
mounted. Read it with `activeAgent()` — **never** cache it in a ref: `sendToAlfa`
can invoke the engine synchronously in the same tick as a switch, so a ref would
still hold the previous agent and the first turn after an `@mention` would carry
the wrong persona.

---

## What actually reaches the model

Exactly three things, assembled in `chat-panel.tsx`:

1. **System prompt** — `composeSystem(agent, modeNote)` in `lib/agent-request.ts`,
   the ONE place that decides this. `HOST_SYSTEM` first (identical every request,
   so the cached prefix is shared), then the mode note, then the active agent's
   name and persona. Rebuilt **every turn**, which is what makes switching agent
   mid-thread take effect.
2. **Tools** — `HOST_AI_TOOLS`, i.e. *all* of them, always. See the scoping decision.
3. **History** — the wire turns. Nothing else. The persona is not in here.

Callers with their own tools pass their own system prompt. The image editor does
**not**, so it runs on the route default in `app/api/assistant/route.ts` — that
constant is reachable and must not be deleted as dead.

## Decided: tool scoping is deleted, not repaired

Every agent gets all 18 tools. This is the contract, not a gap.

Four reasons, and the third is the one that settles it:

1. **The lock is already there and it is better.** Every `mutate` tool parks on a
   per-call approval card, under a server-side path jail. A per-agent grant list is
   a second lock on a door that asks for a key every single time.
2. **It has never been a security boundary.** `lib/host/*` is. The approval gate is
   an additional *human* layer, which `use-host-commands.ts` already says in a
   comment.
3. **A per-agent tool array would cost real money.** The tools block sits *before*
   `system` in the cached prefix, and `app/api/assistant/route.ts` marks the system
   block `cache_control: ephemeral`. Forking the tool array per agent means a cold
   prompt cache on every agent switch — a BYOK bill for a feature that grants
   nothing.
4. **It makes an impossible state impossible.** With one tool set, a thread whose
   history holds `tool_use` for a tool "the new agent lacks" cannot occur.

**Done 2026-07-30.** The tool picker, the "Generalist / Curated — by skill" switch,
the per-agent Skills grant list and every string that counted tools per agent are
gone; `toolsForAgent()` went with them. `agent.allTools` and `agent.skills` remain on
the type because they are persisted and `store-migration.test.ts` covers them — they
are inert data now, not a grant. A release-gate audit caught this still shipping: a
preset agent rendered "Ops · 2 skills · 11 tools" while all 18 were sent, so someone
curating a System-only agent was handing the model `fs.read` over their whole read
jail and believing otherwise.

## Known gaps — stated, not hidden

These survive because fixing them is a redesign, not a cleanup. Listed so nobody
re-discovers them as bugs.

1. **`Skill.starters`** is typed, edited and labelled "shown as quick chips" — and
   nothing renders it. (`instructions` IS rendered, as the card body in the library
   grid; it just never reaches the model.)
2. **`/api/skills` is uncached**, `force-dynamic`, ~90 files across 5 roots per
   call.
3. **The `Skill` → `Playbook` rename has not happened.** The code and the UI still
   say "Skill" for the localStorage type.

### Closed

- ~~`@agent` is cosmetic~~ — the store is module-level and a pick carries
  `MentionItem.onPick`, which switches the active agent. Verified on a phone:
  picking `@Ops` writes `alfa.activeAgent`.
- ~~The persona is a fake user turn~~ — it is `composeSystem()`, per request.
