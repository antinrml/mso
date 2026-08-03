import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEEPER, INSTALL_GUIDE, REPO, START_HERE } from "./links";

// Read the sources rather than importing the barrels: `@/features/os-shell` pulls
// the whole React shell, which a node-env unit test has no business booting.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("docs app", () => {
  it("is registered in the shell so it can reach the dock", () => {
    const manifest = read("../os-shell/shell.manifest.ts");
    expect(manifest).toContain('import { docsApp } from "@/features/docs"');
    expect(manifest).toContain('withSlug(docsApp, "docs")');
    // noDock would hide it from the one surface a signed-out visitor looks at.
    expect(read("./index.ts")).not.toContain("noDock");
  });

  it("is promoted while signed out, so the menu matches the state", () => {
    const osRoot = read("../../../app/os-root.tsx");
    expect(osRoot).toContain('status === "out"');
    expect(osRoot).toContain('a.id === "docs"');
  });

  it("leads with the install guide this instance serves itself", () => {
    // Same-origin on purpose: it must work for a visitor who cannot reach GitHub.
    expect(INSTALL_GUIDE.href).toBe("/install");
    expect(START_HERE[0].href).toBe(REPO);
  });

  it("points every external link at the real repo", () => {
    for (const l of [...START_HERE, ...DEEPER]) {
      expect(l.href.startsWith(REPO) || l.href.startsWith("/")).toBe(true);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.desc.length).toBeGreaterThan(0);
    }
  });
});

describe("quicklinks defaults", () => {
  it("are the owner's accounts, not the project's docs", async () => {
    // The four GitHub file URLs that used to seed here now live in the Docs app.
    // A shortcut rail that ships the project's own documentation is a second,
    // worse copy of Docs — and leaves the owner nowhere to put their own links.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../../lib/quicklinks/store.tsx", import.meta.url), "utf8"),
    );
    const defaults = src.slice(src.indexOf("const DEFAULTS"), src.indexOf("type Ctx"));
    expect(defaults).not.toContain("/blob/main/");
    expect(defaults).not.toContain("github.com/rahmanef63/mso");
    for (const host of ["github.com", "linkedin.com", "instagram.com"]) {
      expect(defaults).toContain(host);
    }
  });
});
