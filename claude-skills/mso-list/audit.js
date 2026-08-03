// os-list audit — logs in (password + approved device → signed cookie) and
// probes every mso /api/v1 function end-to-end, printing a pass/fail table.
// No Convex (removed 2026-05-30) — auth is the session cookie.
//   node ~/.claude/skills/mso-list/audit.js
const fs = require("fs");
// Read a key from mso/.env.local — so the password is sourced, never hardcoded.
function fromEnvFile(key) {
  try {
    const t = fs.readFileSync(process.env.OS_ENV || "/home/rahman/projects/mso/.env.local", "utf8");
    const m = t.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
  } catch {
    return "";
  }
}
const BASE = process.env.OS_BASE || "https://mso.rahmanef.com";
const PASS = process.env.OS_PASSWORD || fromEnvFile("OS_LOGIN_PASSWORD");
const DEV =
  process.env.OS_DEVICE ||
  (() => { try { return require("fs").readFileSync(require("os").homedir() + "/.mso/cli.device.id", "utf8").trim(); } catch { return "46e72d1e9b22372eb6bdd6b76b11192b"; } })();
// proxy.ts blocks mutating /api without same-origin proof; Origin==Host is the
// documented non-browser path.
const ORIGIN = { origin: BASE };
if (!PASS) {
  console.error("no password — set OS_PASSWORD or OS_LOGIN_PASSWORD in mso/.env.local");
  process.exit(1);
}

(async () => {
  // 1) login → capture the session cookie.
  let cookie;
  try {
    const r = await fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...ORIGIN },
      body: JSON.stringify({ password: PASS, deviceId: DEV, deviceLabel: "os-list audit" }),
    });
    if (r.status === 403) {
      console.error("device_pending — approve it: node ~/projects/mso/scripts/approve-device.js " + DEV);
      process.exit(1);
    }
    if (!r.ok) {
      console.error("login failed:", r.status, (await r.json().catch(() => ({}))).error);
      process.exit(1);
    }
    const sc = r.headers.get("set-cookie") || "";
    cookie = (sc.match(/session=[^;]+/) || [])[0];
  } catch (e) {
    console.error("login error:", e.message);
    process.exit(1);
  }
  if (!cookie) {
    console.error("no session cookie returned");
    process.exit(1);
  }
  const H = { cookie, "content-type": "application/json" };

  const probes = [
    ["GET", "/api/v1/sys/stats", null, "system-monitor: live CPU/mem/disk"],
    ["GET", "/api/v1/sys/processes", null, "system-monitor: process table"],
    ["GET", "/api/v1/fs/list?path=~", null, "files/code/tree: list dir"],
    ["GET", "/api/v1/fs/usage?path=~", null, "files: storage gauge"],
    ["GET", "/api/v1/apps", null, "app-store: runtime apps"],
    ["POST", "/api/v1/exec/run", { cmd: "echo ok" }, "terminal/runtime-app: exec"],
    ["POST", "/api/v1/fs/mkdir", { path: "~/.os-audit" }, "files/tree: new folder"],
    ["POST", "/api/v1/fs/write", { path: "~/.os-audit/a", content: "x" }, "files/tree/editor: write/save"],
    // Reads back what the write probe just made: any path under $HOME is inside
    // OS_FS_READ_ROOTS on every install, unlike the /etc/hostname this used to
    // probe (that only passed while the roots were the wide-open "/").
    ["GET", "/api/v1/fs/read?path=~/.os-audit/a", null, "code/viewer: read file"],
    ["POST", "/api/v1/fs/move", { from: "~/.os-audit/a", to: "~/.os-audit/b" }, "files: move/rename"],
    ["POST", "/api/v1/fs/copy", { from: "~/.os-audit/b", to: "~/.os-audit/c" }, "files: copy"],
    ["DELETE", "/api/v1/fs/delete", { path: "~/.os-audit" }, "files: delete/trash"],
    // The Browser app is Camoufox now; /api/v1/browser was retired with the
    // Playwright sidecar and 404s.
    ["GET", "/api/v1/camoufox/service", null, "browser: camoufox VNC service state"],
  ];
  console.log(`OS function audit @ ${BASE} (cookie auth)\n`);
  let ok = 0;
  for (const [m, p, b, label] of probes) {
    try {
      const r = await fetch(BASE + p, { method: m, headers: { ...H, ...ORIGIN }, body: b ? JSON.stringify(b) : undefined });
      console.log(`${r.ok ? "OK  " : "FAIL"} ${r.status}  ${m.padEnd(6)} ${p.split("?")[0].padEnd(24)} ${label}`);
      if (r.ok) ok++;
    } catch (e) {
      console.log(`ERR      ${m.padEnd(6)} ${p.split("?")[0].padEnd(24)} ${e.message}`);
    }
  }
  console.log(`\n${ok}/${probes.length} endpoints OK`);
})();
