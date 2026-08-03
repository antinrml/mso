import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The CLI's dispatch table and its help are the same comment block, so a verb
// that exists in one and not the other is a real bug. These run WITHOUT a server:
// help and unknown-command are the two paths that must never need auth, because
// they are what you reach for when the service is down.
const CLI = path.join(__dirname, "mso");
const run = (...args: string[]) =>
  execFileSync(CLI, args, { encoding: "utf8", env: { ...process.env, MSO_ENV: "/dev/null" } });

describe("bin/mso", () => {
  it("prints help without logging in", () => {
    const out = run("-h");
    expect(out).toContain("Manef Shell OS");
    expect(out).toContain("Usage: mso");
    for (const verb of ["camoufox", "approve", "service", "api", "exec", "doctor"]) {
      expect(out).toContain(verb);
    }
  });

  it("documents every verb the dispatch table implements", () => {
    const src = require("node:fs").readFileSync(CLI, "utf8") as string;
    const body = src.slice(src.indexOf('cmd="${1:-help}"'));
    // Case arms look like `  ls)` / `  camoufox)` / `  devices|device)`. Aliases
    // are split out too — an alias absent from the help is just as unfindable.
    const verbs = [...body.matchAll(/^ {2}([a-z][a-z|-]*)\)/gm)].flatMap((m) => m[1].split("|"));
    expect(verbs.length).toBeGreaterThan(20);
    expect(verbs).toContain("device");
    const help = run("-h");
    // `help`/`-h`/`--help` are the conventional flags every CLI has; they don't
    // need a line in the very help they print.
    const undocumented = verbs.filter(
      (v) => v !== "help" && !v.startsWith("-") && !help.includes(v),
    );
    expect(undocumented).toEqual([]);
  });

  it("exits non-zero on an unknown command", () => {
    expect(() => run("definitely-not-a-verb")).toThrow();
  });

  // "Covers every need" is only true if it stays true. Every API route must be
  // reachable by a named verb, except the ones a shell genuinely cannot drive.
  it("has a named verb for every API route", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const repo = path.join(__dirname, "..");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : e.name === "route.ts" ? [p] : [];
      });
    const routes = walk(path.join(repo, "app/api")).map((p) =>
      "/" + path.relative(repo, p).replace(/^app\//, "").replace(/\/route\.ts$/, ""),
    );
    const cli = fs.readFileSync(CLI, "utf8");

    // Browser-only surfaces: an OAuth redirect needs a browser to land on, the
    // service worker is fetched by the browser itself, and the managed-app proxy
    // exists to be iframed. /api/auth/devices reads the same store `mso device
    // list` reads straight off disk, which also works with the service down.
    const browserOnly = [
      "/api/oauth/[provider]",
      "/api/sw",
      "/api/v1/managed-apps/[id]/proxy/[[...path]]",
      "/api/auth/devices",
    ];

    const uncovered = routes.filter((r) => {
      if (browserOnly.includes(r)) return false;
      // The CLI builds dynamic segments by interpolation, so compare on the
      // literal chunks either side of a [param] rather than the whole path.
      const parts = r.split("/").filter((s) => s && !s.startsWith("["));
      const tail = parts[parts.length - 1];
      return !cli.includes(`/${parts.join("/")}`) && !cli.includes(`/${tail}"`) && !cli.includes(`/${tail}?`);
    });
    expect(uncovered).toEqual([]);
    expect(routes.length).toBeGreaterThan(40);
  });

  it("refuses `device revoke all` without --yes, and leaves the store intact", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-")), "devices.json");
    const before = JSON.stringify({ approved: { ["a".repeat(32)]: { label: "x" } }, pending: {} });
    fs.writeFileSync(store, before);
    const withStore = (...args: string[]) =>
      execFileSync(CLI, args, {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store },
      });

    // Revoking everything signs every browser out; one keystroke from `revoke <id>`.
    expect(() => withStore("device", "revoke", "all")).toThrow();
    expect(fs.readFileSync(store, "utf8")).toBe(before);

    // "-yes" is one character from "--yes"; a near miss must not silently count
    // as confirmation, and must say which flag was actually seen.
    let stderr = "";
    try {
      withStore("device", "revoke", "all", "-yes");
    } catch (e) {
      stderr = String((e as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain('you passed "-yes"');
    expect(fs.readFileSync(store, "utf8")).toBe(before);

    withStore("device", "revoke", "all", "--yes");
    expect(JSON.parse(fs.readFileSync(store, "utf8")).approved).toEqual({});
  });

  it("accepts -y as confirmation and reports what is left after a single revoke", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-"));
    const store = path.join(dir, "devices.json");
    const ids = ["a".repeat(32), "b".repeat(32)];
    const seed = () =>
      fs.writeFileSync(
        store,
        JSON.stringify({ approved: { [ids[0]]: { label: "one" }, [ids[1]]: { label: "two" } }, pending: {} }),
      );
    const withStore = (...args: string[]) =>
      execFileSync(CLI, args, {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store },
      });

    seed();
    withStore("device", "revoke", "all", "-y");
    expect(JSON.parse(fs.readFileSync(store, "utf8")).approved).toEqual({});

    // Revoking your last device locks you out of the UI — that has to be loud.
    seed();
    expect(withStore("revoke", ids[0])).toContain("1 device(s) still approved");
    expect(withStore("revoke", ids[1])).toContain("NO devices approved");
  });
});
