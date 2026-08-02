/* ContextMenu keyboard/lifecycle invariants (vitest, node env). No DOM renderer
   is installed (environment: "node", no jsdom/@testing-library, and this round
   may not add deps), so these are source-level guards on the exact lines that
   broke — same approach as window-preview.test.tsx / context-menu-parts.test.ts. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "context-menu.tsx"), "utf8");
const at = src.indexOf("const px = pos?.x");
const lifeAt = src.indexOf("useEffect(", at);
const listenAt = src.indexOf("useEffect(", lifeAt + 1);
const layoutAt = src.indexOf("useLayoutEffect(", at);
const lifecycle = src.slice(lifeAt, listenAt); // destructive open/close effect
const listener = src.slice(listenAt, layoutAt); // inert keydown/scroll effect

const depsOf = (s: string) =>
  [...s.matchAll(/\}, \[([^\]]*)\]\);/g)].at(-1)?.[1].split(",").map((d) => d.trim()).filter(Boolean) ?? [];
const cleanupOf = (s: string) => s.slice(s.indexOf("return () => {"));

describe("effect split", () => {
  it("has a destructive lifecycle effect and a separate listener effect", () => {
    expect(lifeAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(lifeAt);
    expect(layoutAt).toBeGreaterThan(listenAt);
  });
});

describe("destructive lifecycle effect", () => {
  const deps = depsOf(lifecycle);

  it("keys on primitive coords, never the pos object", () => {
    // Callers rebuild `pos` every render (ShellContextMenu does), and this cleanup
    // calls closeSub() + refocuses the trigger — so an object dep let ANY re-render
    // of the hosting shell destroy an open submenu mid-keyboard-navigation.
    expect(deps).toContain("px");
    expect(deps).toContain("py");
    expect(deps).not.toContain("pos");
  });

  it("never depends on onClose — a caller's inline closure must not tear it down", () => {
    // ContextMenuHost wraps the whole desktop and re-renders on every window-store
    // patch (open/minimize/focus a window). With `onClose` here, a fresh prop
    // identity re-ran this effect => closeSub() + focus yanked back to the trigger,
    // so an open Workspace submenu died on any unrelated window activity.
    expect(deps).not.toContain("onClose");
    expect(deps.every((d) => ["px", "py", "closeSub", "openSub", "cancelClose"].includes(d))).toBe(true);
  });

  it("still re-arms when the menu is reopened at a new position", () => {
    expect(lifecycle).toMatch(/if \(px === undefined \|\| py === undefined\) return;/);
  });

  it("owns the submenu teardown + focus restore", () => {
    const cleanup = cleanupOf(lifecycle);
    expect(cleanup).toMatch(/closeSub\(\);/);
    expect(cleanup).toMatch(/trigger\?\.focus\?\.\(\);/);
  });
});

describe("listener effect", () => {
  it("may depend on onClose because its cleanup is inert", () => {
    expect(depsOf(listener)).toContain("onClose");
  });

  it("detaches listeners and NOTHING else — no closeSub/focus in this teardown", () => {
    const cleanup = cleanupOf(listener);
    expect(cleanup).toMatch(/removeEventListener\("keydown"/);
    expect(cleanup).toMatch(/removeEventListener\("scroll"/);
    expect(cleanup).not.toMatch(/closeSub\(/);
    expect(cleanup).not.toMatch(/focus/);
  });
});

describe("APG menu keyboard support", () => {
  it("dismisses the whole menu on Tab instead of letting focus leave the portal", () => {
    expect(listener).toMatch(/e\.key === "Tab".*onClose\(\)/s);
  });

  it("supports Home/End alongside the arrow keys", () => {
    expect(listener).toMatch(/\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(e\.key\)/);
    expect(listener).toMatch(/e\.key === "Home" \? 0 : e\.key === "End" \? list\.length - 1/);
  });

  it("navigates the focused panel only (root vs submenu)", () => {
    expect(listener).toMatch(/btns\(inSub \? subRef\.current : menuRef\.current\)/);
  });
});
