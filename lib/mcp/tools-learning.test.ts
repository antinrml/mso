import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-bootstrap-"));
const project = path.join(dir, "mso");
await fs.mkdir(project);
await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
  name: "mso", version: "9.9.9", scripts: { test: "vitest", build: "next build" },
}));
const previous = {
  read: process.env.OS_FS_READ_ROOTS,
  write: process.env.OS_FS_WRITE_ROOTS,
  memory: process.env.OS_SKILL_MEMORY_STORE,
};
process.env.OS_FS_READ_ROOTS = dir;
process.env.OS_FS_WRITE_ROOTS = dir;
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const { resetSkillMemoryCache } = await import("@/lib/skills/memory");
const { LEARNING_TOOLS } = await import("./tools-learning");

describe("workflow_start bootstrap", () => {
  afterAll(async () => {
    if (previous.read === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previous.read;
    if (previous.write === undefined) delete process.env.OS_FS_WRITE_ROOTS;
    else process.env.OS_FS_WRITE_ROOTS = previous.write;
    if (previous.memory === undefined) delete process.env.OS_SKILL_MEMORY_STORE;
    else process.env.OS_SKILL_MEMORY_STORE = previous.memory;
    resetSkillMemoryCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns project, toolset, skill search and an executable trace in one call", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start");
    expect(start).toBeDefined();
    const result = await start!.run({
      intent: "inspect and safely update the MSO repository, then verify it",
      project,
      constraints: "no production downtime",
    }, { actor: "mcp:test-bootstrap", scope: "write" }) as {
      workflow: { project?: string };
      bootstrap: {
        ready: boolean;
        project: { path: string; matchedBy: string };
        repository: { package: { name?: string; version?: string; scripts: string[] }; git: { statusChecked: boolean } };
        toolset: { toolCount: number; names: string[]; hash: string };
        trace: string[];
      };
      search: { hits: Array<{ kind: string; name: string; trust?: string }> };
    };

    expect(result.workflow.project).toBe(project);
    expect(result.bootstrap).toMatchObject({
      ready: true,
      project: { path: project, matchedBy: "path" },
      repository: { package: { name: "mso", version: "9.9.9", scripts: ["test", "build"] }, git: { statusChecked: false } },
    });
    expect(result.bootstrap.toolset.toolCount).toBeGreaterThan(10);
    expect(result.bootstrap.toolset.names).toContain("workflow_start");
    expect(result.bootstrap.toolset.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.bootstrap.trace).toEqual(expect.arrayContaining([
      expect.stringContaining("[MSO]"),
      expect.stringContaining("[Project]"),
      expect.stringContaining("[Plan]"),
    ]));
    expect(result.search.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "skill", name: "mso-repo-work", trust: "official" }),
    ]));
  });
});
