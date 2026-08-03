#!/usr/bin/env node
// Seed / list / revoke trusted login devices for mso (no Convex — flat JSON,
// same model as the VPS Control Room).
//
//   node scripts/approve-device.js <deviceId> [label]   # approve a device
//   node scripts/approve-device.js --list               # show approved + pending
//   node scripts/approve-device.js --revoke <deviceId>  # un-trust a device
//
// Store path = ~/.mso/auth-devices.json unless OS_DEVICE_STORE is set (must
// match what the mso service sees).

const fs = require("fs");
const os = require("os");
const path = require("path");

const STORE =
  process.env.OS_DEVICE_STORE || path.join(os.homedir(), ".mso", "auth-devices.json");
const DEVICE_ID_RE = /^[a-f0-9-]{16,128}$/i;

function read() {
  try {
    const p = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return { approved: p.approved || {}, pending: p.pending || {} };
  } catch {
    return { approved: {}, pending: {} };
  }
}
function write(store) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE);
}
const ts = (t) => (t ? new Date(t).toISOString() : "—");

const args = process.argv.slice(2);

if (args[0] === "--list") {
  const s = read();
  console.log(`store: ${STORE}\n\nAPPROVED:`);
  const ap = Object.entries(s.approved);
  if (!ap.length) console.log("  (none)");
  for (const [id, d] of ap) console.log(`  ${id}  "${d.label}"  approved=${ts(d.approvedAt)} lastSeen=${ts(d.lastSeen)}`);
  console.log("\nPENDING (typed correct password, awaiting approval):");
  const pd = Object.entries(s.pending);
  if (!pd.length) console.log("  (none)");
  for (const [id, d] of pd) console.log(`  ${id}  "${d.label}"  ip=${d.ip} attempts=${d.attempts} last=${ts(d.lastSeen)}`);
  process.exit(0);
}

if (args[0] === "--pending") {
  const s = read();
  const pd = Object.entries(s.pending);
  console.log(`store: ${STORE}\n\nPENDING (typed correct password, awaiting approval):`);
  if (!pd.length) console.log("  (none)");
  for (const [id, d] of pd) console.log(`  ${id}  "${d.label}"  ip=${d.ip} attempts=${d.attempts} last=${ts(d.lastSeen)}`);
  if (pd.length) console.log(`\napprove: mso device approve ${pd[0][0]} "a label"`);
  process.exit(0);
}

if (args[0] === "--revoke-all") {
  // Locks every browser out at once. Recoverable — approving is a local file
  // write that needs no session — but the confirmation is not optional, because
  // this is one keystroke away from `--revoke <id>`.
  const s = read();
  const ids = Object.keys(s.approved);
  if (!ids.length) { console.log("nothing to revoke — no approved devices"); process.exit(0); }
  const confirm = args[1];
  if (confirm !== "--yes" && confirm !== "-y") {
    console.error(`refusing: this revokes ALL ${ids.length} approved devices and signs every browser out.`);
    // Naming what they actually typed: "-yes" and "--yes" are one character apart
    // and a bare "re-run with --yes" leaves them re-reading their own line.
    if (confirm) console.error(`(you passed "${confirm}" — the flag is --yes or -y)`);
    console.error("re-run with --yes if that is what you want. Re-approve later with:");
    console.error("  mso device approve <deviceId> \"label\"");
    process.exit(1);
  }
  s.approved = {};
  write(s);
  console.log(`revoked ${ids.length} device(s):`);
  for (const id of ids) console.log(`  ${id}`);
  console.log("\nno device can sign in until you approve one again.");
  process.exit(0);
}

if (args[0] === "--revoke") {
  const id = args[1];
  if (!id) { console.error("usage: --revoke <deviceId>"); process.exit(1); }
  const s = read();
  if (!s.approved[id]) {
    console.error(`not approved: ${id}`);
    if (id === "all") console.error("to revoke every device: mso device revoke all --yes");
    process.exit(1);
  }
  const label = s.approved[id].label;
  delete s.approved[id];
  write(s);
  const left = Object.keys(s.approved).length;
  // Say what is left, so the obvious follow-up (`device list`) isn't needed — and
  // so revoking your last device is impossible to do without noticing.
  console.log(`revoked ${id}  "${label}"`);
  console.log(left ? `${left} device(s) still approved.` : "NO devices approved now — nothing can sign in until you approve one.");
  process.exit(0);
}

const id = args[0];
const label = args.slice(1).join(" ") || "seeded device";
if (!id || !DEVICE_ID_RE.test(id)) {
  console.error("usage: approve-device.js <deviceId> [label] | --list | --revoke <id>");
  console.error("deviceId must be 16-128 hex/uuid chars");
  process.exit(1);
}
const store = read();
const pending = store.pending[id];
store.approved[id] = {
  label: label !== "seeded device" ? label : (pending && pending.label) || label,
  approvedAt: Date.now(),
};
delete store.pending[id];
write(store);
console.log(`approved ${id}  "${store.approved[id].label}"`);
console.log("-> that device can now sign in with the password.");
