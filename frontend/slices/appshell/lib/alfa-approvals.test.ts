import { describe, expect, it } from "vitest";
import { awaitAlfaApproval, resolveAlfaApproval, clearAlfaApprovals } from "./alfa-approvals";

// The rendezvous a parked mutate-tool call waits on. It lived inside the Assistant
// panel, which made it unreachable from the mobile sheet (only the focused app is
// rendered there) — so a tool asked for from the sheet hung the agent forever.
describe("alfa approvals are answerable from any surface", () => {
  it("resolves the waiting call with the decision", async () => {
    const p = awaitAlfaApproval("card-1");
    resolveAlfaApproval("card-1", true, true);
    await expect(p).resolves.toEqual({ approve: true, remember: true });
  });

  it("carries a denial through", async () => {
    const p = awaitAlfaApproval("card-2");
    resolveAlfaApproval("card-2", false, false);
    await expect(p).resolves.toEqual({ approve: false, remember: false });
  });

  it("ignores an unknown id instead of throwing", () => {
    expect(() => resolveAlfaApproval("nope", true, false)).not.toThrow();
  });

  it("resolves each card independently", async () => {
    const a = awaitAlfaApproval("a");
    const b = awaitAlfaApproval("b");
    resolveAlfaApproval("b", true, false);
    await expect(b).resolves.toEqual({ approve: true, remember: false });
    resolveAlfaApproval("a", false, false);
    await expect(a).resolves.toEqual({ approve: false, remember: false });
  });

  // Stop must unwind every parked call, or the loop stays blocked after abort.
  it("clear() denies everything still waiting", async () => {
    const a = awaitAlfaApproval("x");
    const b = awaitAlfaApproval("y");
    clearAlfaApprovals();
    await expect(a).resolves.toEqual({ approve: false, remember: false });
    await expect(b).resolves.toEqual({ approve: false, remember: false });
    // and the map is empty, so a late resolve is a no-op
    expect(() => resolveAlfaApproval("x", true, true)).not.toThrow();
  });

  it("a second resolve for the same card does nothing", async () => {
    const p = awaitAlfaApproval("once");
    resolveAlfaApproval("once", true, false);
    await expect(p).resolves.toEqual({ approve: true, remember: false });
    expect(() => resolveAlfaApproval("once", false, false)).not.toThrow();
  });
});
