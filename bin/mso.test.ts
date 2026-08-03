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
    expect(out).toContain("drive the whole Manef Shell OS");
    for (const verb of ["camoufox", "approve", "service", "api", "exec"]) {
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

    withStore("device", "revoke", "all", "--yes");
    expect(JSON.parse(fs.readFileSync(store, "utf8")).approved).toEqual({});
  });
});
