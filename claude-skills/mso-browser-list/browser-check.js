// os-browser-list — checks the REAL browser service (Playwright Chromium, systemd
// os-browser). Navigates several sites and reports title + screenshot bytes +
// content length, proving any site renders (no X-Frame-Options problem). Runs on
// the host (loopback). Usage:  node ~/.claude/skills/mso-browser-list/browser-check.js
const fs = require("fs");

const ENVF = process.env.OS_BROWSER_ENV || "/home/rahman/projects/os-browser/.env";
const BASE = process.env.OS_BROWSER_BASE || "http://127.0.0.1:4002";
let SECRET = process.env.OS_BROWSER_SECRET || "";
try {
  if (!SECRET) {
    const m = fs.readFileSync(ENVF, "utf8").match(/^OS_BROWSER_SECRET=(.+)$/m);
    if (m) SECRET = m[1].trim();
  }
} catch {}
const H = { "x-os-browser-secret": SECRET, "content-type": "application/json" };

const SITES = ["https://example.com", "https://news.ycombinator.com", "https://www.google.com", "https://github.com"];

(async () => {
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    console.log(`os-browser service: ${h.ok ? "UP" : "DOWN"} @ ${BASE}\n`);
  } catch (e) {
    console.log(`os-browser DOWN @ ${BASE}: ${e.message}\n(sudo systemctl status os-browser)`);
    process.exit(1);
  }
  for (const url of SITES) {
    try {
      const nav = await fetch(`${BASE}/navigate`, { method: "POST", headers: H, body: JSON.stringify({ url }) }).then((r) => r.json());
      const png = await fetch(`${BASE}/screenshot`, { headers: H }).then((r) => r.arrayBuffer());
      const c = await fetch(`${BASE}/content`, { headers: H }).then((r) => r.json());
      console.log(`OK  "${(nav.title || "").slice(0, 30)}"  shot=${png.byteLength}b  text=${(c.text || "").length}  ${url}`);
    } catch (e) {
      console.log(`ERR ${url}  ${e.message}`);
    }
  }
  console.log("\nWeb path: /api/v1/browser/* (Convex-auth) → 172.18.0.1:4002. CLI: ~/.claude/skills/mso/browser.sh");
})();
