// SERVER-ONLY. Host telemetry behind /api/v1/sys/*. CPU% is a short two-sample
// delta of /proc/stat; mem/disk/uptime from os + statfs; processes parsed from
// `ps`. Linux-oriented (the deploy target); degrades to zeros if /proc absent.
import os from "os";
import { promises as fs } from "fs";
import type { Process, SysStats } from "@/lib/os-api/types";
import { runCommand } from "./exec";

async function cpuSample(): Promise<{ idle: number; total: number }> {
  try {
    const line = (await fs.readFile("/proc/stat", "utf8")).split("\n")[0];
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] || 0) + (n[4] || 0); // idle + iowait
    const total = n.reduce((a, b) => a + (b || 0), 0);
    return { idle, total };
  } catch {
    return { idle: 0, total: 0 };
  }
}

// CPU% needs two /proc/stat samples. Taking both inside one request means every
// caller pays a 120ms sleep — and the System Monitor polls this every 1500ms, so
// the handler sat blocked for 8% of wall-clock forever. Keep the last sample
// instead: a poll that arrives while a usable one is on hand diffs against it and
// returns immediately.
//
// The window has both ends for a reason. Below MIN, the delta is too few jiffies
// to mean anything (and can read 0 on an idle box). Above MAX, the delta stops
// being "now" — a sample from ten minutes ago would report the ten-minute average
// as the current load. Outside the window we fall back to the honest two-sample
// read, so correctness never depends on how often someone happens to be polling.
const REUSE_MIN_MS = 200;
const REUSE_MAX_MS = 10_000;
let lastSample: { at: number; idle: number; total: number } | null = null;

export async function stats(): Promise<SysStats> {
  const now = Date.now();
  const prev = lastSample;
  const reusable = prev && now - prev.at >= REUSE_MIN_MS && now - prev.at <= REUSE_MAX_MS;

  let a: { idle: number; total: number };
  if (reusable) {
    a = prev;
  } else {
    a = await cpuSample();
    await new Promise((r) => setTimeout(r, 120));
  }
  const b = await cpuSample();
  lastSample = { at: Date.now(), idle: b.idle, total: b.total };

  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  const pct = dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0;

  let disk = { used: 0, total: 0 };
  try {
    const s = await fs.statfs("/");
    const total = s.blocks * s.bsize;
    disk = { used: total - s.bfree * s.bsize, total };
  } catch {
    /* non-linux / no statfs → zeros */
  }

  return {
    cpu: { pct, cores: os.cpus().length },
    mem: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
    disk,
    net: { rx: 0, tx: 0 },
    uptime: os.uptime() * 1000,
  };
}

export async function processes(): Promise<Process[]> {
  const r = await runCommand(
    "ps -eo pid,comm,pcpu,rss,stat --sort=-pcpu --no-headers | head -40",
  );
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // comm may contain spaces ("npm exec eslint"): pid is the first token,
      // pcpu/rss/stat are the space-free last three — name is what's between.
      const m = l.split(/\s+/);
      if (m.length < 5) return { pid: 0, name: "?", status: "", cpu: 0, mem: 0 };
      return {
        pid: Number(m[0]) || 0,
        name: m.slice(1, -3).join(" "),
        status: m[m.length - 1] ?? "",
        cpu: Number(m[m.length - 3]) || 0,
        mem: Math.round((Number(m[m.length - 2]) || 0) / 1024), // RSS KB → MB
      };
    })
    .filter((p) => p.pid > 0);
}
