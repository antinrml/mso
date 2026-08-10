import { describe, it, expect } from "vitest";
import { sameGeometry } from "./responsive-provider";
import type { Responsive } from "./use-responsive";

const base: Responsive = {
  formFactor: "desktop",
  isMobile: false,
  device: "auto",
  vw: 1280,
  vh: 800,
  pointer: "fine",
  orientation: "landscape",
  breakpoint: "lg",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

describe("sameGeometry", () => {
  it("is false against null, so the first measurement always commits", () => {
    expect(sameGeometry(null, base)).toBe(false);
  });

  it("is true for an identical viewport — this is what stops the shell re-rendering", () => {
    expect(sameGeometry(base, { ...base })).toBe(true);
  });

  it("ignores safeArea, which is derived from the fields it does compare", () => {
    expect(sameGeometry(base, { ...base, safeArea: { top: 44, right: 0, bottom: 34, left: 0 } })).toBe(true);
  });

  it.each([
    ["vw", { vw: 1281 }],
    ["vh", { vh: 799 }], // a mobile URL-bar collapse
    ["isMobile", { isMobile: true }],
    ["device", { device: "phone" as const }],
    ["pointer", { pointer: "coarse" as const }],
    ["orientation", { orientation: "portrait" as const }],
    ["breakpoint", { breakpoint: "md" as const }],
  ])("is false when %s changes", (_label, patch) => {
    expect(sameGeometry(base, { ...base, ...patch })).toBe(false);
  });
});
