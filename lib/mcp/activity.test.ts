import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-mcp-activity-"));
process.env.OS_MCP_ACTIVITY_LOG = path.join(dir, "activity.log");
const { activityTarget, readMcpActivity, recordMcpActivity } = await import("./activity");

describe("MCP activity stream", () => {
  beforeAll(async () => { await fs.rm(process.env.OS_MCP_ACTIVITY_LOG!, { force: true }); });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("never serializes fs_write content into the activity target", () => {
    expect(activityTarget({ path: "/tmp/note.txt", content: "super secret body" })).toBe("/tmp/note.txt");
    expect(activityTarget({ content: "super secret body" })).toBeUndefined();
  });

  it("collates started/completed rows newest-first with one correlation id", async () => {
    await recordMcpActivity({ id: "a", tool: "sys_stats", state: "started", scope: "read" });
    await recordMcpActivity({ id: "a", tool: "sys_stats", state: "completed", scope: "read", durationMs: 12 });
    const rows = await readMcpActivity(10);
    expect(rows[0]).toMatchObject({ id: "a", state: "completed", durationMs: 12 });
    expect(rows[1]).toMatchObject({ id: "a", state: "started" });
  });
});
