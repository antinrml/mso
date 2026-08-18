// MSO capability audit — complete route inventory + safe live probes.
// PASS means this script exercised the endpoint end-to-end. UNPROBED is explicit:
// secret-returning, destructive, long-running, streaming, or target-dependent routes
// are never painted green merely to raise a percentage.
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = process.env.MSO_DIR || path.resolve(path.dirname(fs.realpathSync(__filename)), "../..");
const ENV_FILE = process.env.OS_ENV || path.join(ROOT, ".env.local");
const BASE = (process.env.OS_BASE || "http://127.0.0.1:4005").replace(/\/$/, "");

function fromEnvFile(key) {
  try {
    const text = fs.readFileSync(ENV_FILE, "utf8");
    const match = text.match(new RegExp("^" + key + "=(.*)$", "m"));
    return match ? match[1].trim().replace(/^[\"']|[\"']$/g, "") : "";
  } catch {
    return "";
  }
}

const PASS = process.env.OS_PASSWORD || fromEnvFile("OS_LOGIN_PASSWORD");
const DEVICE = process.env.OS_DEVICE || (() => {
  try {
    return fs.readFileSync(path.join(os.homedir(), ".mso/cli.device.id"), "utf8").trim();
  } catch {
    console.error("no CLI device id — run the installed MSO CLI `whoami` once, then approve that device");
    process.exit(1);
  }
})();
const ORIGIN = { origin: BASE };
if (!PASS) {
  console.error(`no login password — set OS_PASSWORD or OS_LOGIN_PASSWORD in ${ENV_FILE}`);
  process.exit(1);
}

function routeInventory() {
  const apiRoot = path.join(ROOT, "app/api/v1");
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === "route.ts") {
        const rel = path.relative(apiRoot, path.dirname(abs)).split(path.sep).join("/");
        out.push(`/api/v1/${rel}`);
      }
    }
  }
  try { walk(apiRoot); } catch {}
  return out.sort();
}

async function login() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...ORIGIN },
    body: JSON.stringify({ password: PASS, deviceId: DEVICE, deviceLabel: "mso capability audit" }),
  });
  if (r.status === 403) throw new Error(`device_pending (${DEVICE})`);
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const cookie = ((r.headers.get("set-cookie") || "").match(/session=[^;]+/) || [])[0];
  if (!cookie) throw new Error("no session cookie returned");
  return cookie;
}

(async () => {
  let cookie;
  try { cookie = await login(); }
  catch (e) { console.error(String(e.message || e)); process.exit(1); }

  const H = { cookie, "content-type": "application/json" };
  const tempDir = "~/.mso-capability-audit";
  const tempFile = `${tempDir}/a.txt`;
  const probes = [
    ["GET", "/api/v1/sys/stats", null, "/api/v1/sys/stats", "system telemetry"],
    ["GET", "/api/v1/sys/processes", null, "/api/v1/sys/processes", "process table"],
    ["GET", "/api/v1/sys/audit?limit=1", null, "/api/v1/sys/audit", "audit trail read"],
    ["GET", "/api/v1/sys/update?check=0", null, "/api/v1/sys/update", "update state, no network check"],
    ["GET", "/api/v1/apps", null, "/api/v1/apps", "runtime app catalog"],
    ["GET", "/api/v1/managed-apps", null, "/api/v1/managed-apps", "managed app catalog"],
    ["GET", "/api/v1/editor/exec", null, "/api/v1/editor/exec", "editor command vocabulary"],
    ["GET", "/api/v1/camoufox/service", null, "/api/v1/camoufox/service", "browser service state; no credential"],
    ["GET", "/api/v1/fs/list?path=~", null, "/api/v1/fs/list", "list home"],
    ["GET", "/api/v1/fs/usage?path=~", null, "/api/v1/fs/usage", "home disk usage"],
    ["GET", "/api/v1/fs/search?q=mso-capability-audit&root=~", null, "/api/v1/fs/search", "bounded directory search"],
    ["POST", "/api/v1/exec/run", { cmd: "printf mso-audit-ok" }, "/api/v1/exec/run", "scoped shell smoke test"],
    ["POST", "/api/v1/fs/mkdir", { path: tempDir }, "/api/v1/fs/mkdir", "create isolated audit dir"],
    ["POST", "/api/v1/fs/write", { path: tempFile, content: "mso-audit" }, "/api/v1/fs/write", "write isolated file"],
    ["GET", `/api/v1/fs/read?path=${encodeURIComponent(tempFile)}`, null, "/api/v1/fs/read", "read isolated file"],
    ["GET", `/api/v1/fs/raw?path=${encodeURIComponent(tempFile)}`, null, "/api/v1/fs/raw", "raw isolated file"],
    ["GET", `/api/v1/fs/zip?base=${encodeURIComponent(tempDir)}&n=a.txt&name=audit.zip`, null, "/api/v1/fs/zip", "zip isolated file"],
    ["POST", "/api/v1/fs/move", { from: tempFile, to: `${tempDir}/b.txt` }, "/api/v1/fs/move", "rename isolated file"],
    ["POST", "/api/v1/fs/copy", { from: `${tempDir}/b.txt`, to: `${tempDir}/c.txt` }, "/api/v1/fs/copy", "copy isolated file"],
    ["DELETE", "/api/v1/fs/delete", { path: tempDir }, "/api/v1/fs/delete", "remove isolated audit dir"],
  ];

  console.log(`MSO capability audit @ ${BASE}`);
  console.log(`repo: ${ROOT}\n`);

  let passed = 0;
  const probedRoutes = new Set();
  for (const [method, endpoint, body, route, label] of probes) {
    try {
      const r = await fetch(BASE + endpoint, {
        method,
        headers: { ...H, ...ORIGIN },
        body: body ? JSON.stringify(body) : undefined,
      });
      const ok = r.ok;
      console.log(`${ok ? "PASS" : "FAIL"} ${String(r.status).padEnd(3)} ${method.padEnd(6)} ${route.padEnd(28)} ${label}`);
      if (ok) passed++;
      probedRoutes.add(route);
      if (r.body) await r.body.cancel().catch(() => {});
    } catch (e) {
      console.log(`FAIL --- ${method.padEnd(6)} ${route.padEnd(28)} ${String(e.message || e)}`);
      probedRoutes.add(route);
    }
  }

  const routes = routeInventory();
  const unprobed = routes.filter((route) => !probedRoutes.has(route));
  const coverage = routes.length ? ((probedRoutes.size / routes.length) * 100).toFixed(1) : "0.0";

  console.log(`\nLive probes: ${passed}/${probes.length} passed`);
  console.log(`Route-file coverage: ${probedRoutes.size}/${routes.length} (${coverage}%)`);
  if (unprobed.length) {
    console.log("\nUNPROBED by design or because they need a dynamic target/stream/mutation:");
    for (const route of unprobed) console.log(`  - ${route}`);
  }
  console.log("\nRule: only PASS is green. UNPROBED is unknown, never assumed working.");
  process.exitCode = passed === probes.length ? 0 : 1;
})();
