import { describe, expect, it } from "vitest";
import { stats } from "./sys";

// The System Monitor polls /api/v1/sys/stats every 1500ms. Taking both /proc/stat
// samples inside one call made every one of those requests sleep 120ms; reusing
// the previous sample removes that for all but the first.
describe("stats", () => {
  it("reuses the previous CPU sample instead of sleeping again", async () => {
    const first = await timed(); // cold: pays the two-sample sleep
    await sleep(250); // past REUSE_MIN_MS, so the cached sample is usable
    const second = await timed();

    expect(first.ms).toBeGreaterThanOrEqual(100);
    expect(second.ms).toBeLessThan(100);
    // Still a real reading, not a shortcut that skips the work.
    expect(second.value.cpu.pct).toBeGreaterThanOrEqual(0);
    expect(second.value.cpu.pct).toBeLessThanOrEqual(100);
    expect(second.value.cpu.cores).toBeGreaterThan(0);
    expect(second.value.mem.total).toBeGreaterThan(0);
  });

  it("returns a whole, sane payload", async () => {
    const s = await stats();
    expect(s.mem.used).toBeLessThanOrEqual(s.mem.total);
    expect(s.disk.used).toBeLessThanOrEqual(s.disk.total);
    expect(s.uptime).toBeGreaterThan(0);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function timed() {
  const t0 = Date.now();
  const value = await stats();
  return { ms: Date.now() - t0, value };
}
