// `app-support.ts` is the fallback the panels use when a route sends no
// capabilities, and it decides which CONTROLS exist at all. Drift between it
// and the server's adapters is a control that 400s — or a flow the operator is
// never offered — so the two tables are compared here rather than trusted.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { supportFor } = await import("./app-support");
const { updateAdapter } = await import("@/lib/managed-apps/update-cli");

describe("the client table mirrors the server adapters", () => {
  it("offers a rollback pin field exactly where the server can build a pin", () => {
    for (const id of ["hermes", "openclaw"] as const) {
      expect(supportFor(id).rollbackPin).toBe(updateAdapter(id).pin !== null);
      expect(supportFor(id).dryRun).toBe(updateAdapter(id).capabilities.dryRun);
    }
  });

  it("tells the operator why Hermes has no pin instead of showing a field that is refused", () => {
    // The pin IS a branch switch there, and `hermes update` auto-stashes local
    // changes — a restore leaves ~/.hermes dirty against an unchanged HEAD, so
    // pinning would stash the files just restored. The server refuses it
    // (update.ts); the panel must not offer it in the first place.
    expect(supportFor("hermes").rollbackPin).toBe(false);
    expect(supportFor("hermes").pinHint).toMatch(/stash/);
    expect(supportFor("openclaw").rollbackPin).toBe(true);
  });
});
