import { describe, expect, it } from "vitest";
import { activeAgent, agentList, setActiveAgentId } from "./store";

// The agent is a module store now, not a per-mount hook. That is what lets the
// Alfa sheet and the desktop dock read and switch it — the reason @agent was
// cosmetic before.
describe("the agent store is reachable without React", () => {
  it("exposes an active agent outside a component", () => {
    expect(activeAgent()).toBeTruthy();
    expect(agentList().length).toBeGreaterThan(0);
  });

  it("switches the active agent, and the change is visible immediately", () => {
    const [first, second] = agentList();
    if (!second) return; // single-agent install
    setActiveAgentId(second.id);
    expect(activeAgent().id).toBe(second.id);
    setActiveAgentId(first.id);
    expect(activeAgent().id).toBe(first.id);
  });

  it("ignores an unknown id rather than dangling the pointer", () => {
    const before = activeAgent().id;
    setActiveAgentId("ag_does_not_exist");
    expect(activeAgent().id).toBe(before);
  });

});
