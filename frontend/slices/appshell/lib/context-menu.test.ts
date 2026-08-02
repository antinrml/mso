import { describe, expect, it } from "vitest";
import { getContextMenuItems, joinGroups, registerContextMenu, submenuPos, type MenuItem } from "./context-menu";

const ctx = (shell: "macos" | "android") =>
  ({ shell, surface: shell === "macos" ? "desktop" : "mobile", x: 10, y: 20 }) as const;

const item = (label: string): MenuItem => ({ label, onClick: () => {} });

describe("context-menu registry", () => {
  it("scopes providers to one shell or all shells", () => {
    const offAll = registerContextMenu("*", () => [item("everywhere")]);
    const offMac = registerContextMenu("macos", () => [item("mac only")]);
    const labels = (s: "macos" | "android") =>
      getContextMenuItems(ctx(s)).map((i) => (i.type === "sep" ? "—" : i.label));
    expect(labels("macos")).toEqual(["everywhere", "—", "mac only"]);
    expect(labels("android")).toEqual(["everywhere"]);
    offAll();
    offMac();
    expect(getContextMenuItems(ctx("macos"))).toEqual([]);
  });

  it("passes the open context (position + surface) to providers", () => {
    let seen: unknown;
    const off = registerContextMenu("android", (c) => {
      seen = c;
      return [item("x")];
    });
    getContextMenuItems(ctx("android"));
    expect(seen).toMatchObject({ shell: "android", surface: "mobile", x: 10, y: 20 });
    off();
  });

  it("skips empty provider results (no dangling separators)", () => {
    const offA = registerContextMenu("*", () => []);
    const offB = registerContextMenu("*", () => [item("only")]);
    expect(getContextMenuItems(ctx("macos"))).toHaveLength(1);
    offA();
    offB();
  });
});

describe("submenu items", () => {
  it("carries nested items through the registry untouched", () => {
    const sub: MenuItem = { type: "submenu", label: "Workspace", items: [item("None"), item("Hermes")] };
    const off = registerContextMenu("*", () => [sub]);
    const [first] = getContextMenuItems(ctx("macos"));
    expect(first.type).toBe("submenu");
    expect(first.type === "submenu" && first.items.map((i) => i.type !== "sep" && i.label)).toEqual(["None", "Hermes"]);
    off();
  });

  it("separates a submenu group like any other group", () => {
    const sub: MenuItem = { type: "submenu", label: "Workspace", items: [item("None")] };
    expect(joinGroups([[item("a")], [sub]]).map((i) => i.type === "sep" ? "—" : i.label)).toEqual(["a", "—", "Workspace"]);
  });
});

describe("submenuPos", () => {
  const view = { w: 1000, h: 800 };
  const size = { w: 200, h: 120 };
  const row = (over: Partial<{ top: number; left: number; right: number }> = {}) => ({ top: 100, left: 300, right: 500, ...over });

  it("opens to the right of the row, overlapping its edge", () => {
    expect(submenuPos(row(), size, view)).toEqual({ x: 496, y: 96, flipped: false });
  });

  it("flips to the left when the panel would overflow the right edge", () => {
    const p = submenuPos(row({ left: 700, right: 900 }), size, view);
    expect(p).toMatchObject({ flipped: true, x: 504 });
  });

  it("stays right-side (clamped) when there is no room on either side", () => {
    const p = submenuPos(row({ left: 20, right: 220 }), { w: 900, h: 120 }, view);
    expect(p.flipped).toBe(false);
    expect(p.x).toBe(view.w - 900 - 8);
  });

  it("lifts a tall panel so its last row stays on screen, never above 8", () => {
    expect(submenuPos(row({ top: 700 }), size, view).y).toBe(800 - 120 - 8);
    expect(submenuPos(row({ top: 0 }), { w: 200, h: 2000 }, view).y).toBe(8);
  });
});

describe("joinGroups", () => {
  it("separates non-empty groups and drops empty ones", () => {
    const out = joinGroups([[item("a")], [], [item("b"), item("c")]]);
    expect(out.map((i) => (i.type === "sep" ? "—" : i.label))).toEqual(["a", "—", "b", "c"]);
  });
  it("returns [] for all-empty input", () => {
    expect(joinGroups([[], []])).toEqual([]);
  });
});
