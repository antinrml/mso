import type { Agent } from "./types";
import { HOST_SYSTEM } from "../host-tools/registry";

// THE one place that decides what system prompt reaches the model.
//
// Before this the persona was pushed into history as a fake user turn — once,
// only when the thread was empty — so the agent chosen at turn zero was the agent
// forever. `system` is per-request all the way down (runToolAgent → streamAgentTurn
// → the route body), so rebuilding it each turn is what makes switching agent
// mid-thread actually take effect.
//
// PROMPT CACHE, stated accurately: the route sends ONE system block with a single
// `cache_control: ephemeral` breakpoint at its END, and the tools array carries no
// breakpoint of its own. Anthropic matches a cached prefix up to a breakpoint
// exactly, so ANY change to the persona misses the whole block — including the
// 18-tool schema that precedes it. Putting HOST_SYSTEM first does NOT keep a shared
// prefix warm; it only keeps the string readable.
//
// That cost is accepted here and rejected for tool scoping, which is not a
// contradiction: a per-agent persona is the feature, and a per-agent tool array
// bought nothing (see the scoping decision in CONTRACT.md). If per-agent material
// grows, the fix is a second breakpoint after the shared head, not reordering.
const PERSONA_CAP = 800;

export function composeSystem(agent: Agent | undefined, modeNote: string): string {
  const persona = agent?.persona?.trim().slice(0, PERSONA_CAP);
  const identity = agent && persona ? ` You are acting as ${agent.name}. ${persona}` : "";
  return HOST_SYSTEM + modeNote + identity;
}
