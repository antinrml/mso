import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-skill-memory-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./memory");

describe("learned workflow recipes", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    memory.resetSkillMemoryCache();
  });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("keeps the fastest successful tool path for a repeated intent", async () => {
    const first = await memory.startWorkflow({ actor: "mcp:test", intent: "capture a macOS screenshot and return a secure temporary link", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", first.workflow.id, {
      id: "a", tool: "screen_capture", state: "completed", args: { shell: "macos", width: 1440, height: 900 }, durationMs: 5000, ts: new Date().toISOString(),
    });
    const one = await memory.finishWorkflow({ actor: "mcp:test", summary: "screenshot and authenticated link verified", success: true });
    expect(one.recipe.fastestDurationMs).toBe(5000);

    const second = await memory.startWorkflow({ actor: "mcp:test", intent: "kirim screenshot macos dengan temporary download link", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", second.workflow.id, {
      id: "b", tool: "screen_capture", state: "completed", args: { shell: "macos", width: 1440, height: 900 }, durationMs: 2200, ts: new Date().toISOString(),
    });
    const two = await memory.finishWorkflow({ actor: "mcp:test", summary: "same result in one faster call", success: true });
    const recipes = await memory.listLearnedRecipes();
    expect(recipes).toHaveLength(1);
    expect(two.recipe.attempts).toBe(2);
    expect(two.recipe.fastestDurationMs).toBe(2200);
    expect(two.improvedByMs).toBe(2800);
    expect(two.recipe.bestSteps.map((s) => s.tool)).toEqual(["screen_capture"]);
    expect(two.recipe.bestSteps[0].args).toEqual({ shell: "macos", width: 1440, height: 900 });
  });

  it("enriches a fastest recipe with safe args from a slower equivalent run", async () => {
    const first = await memory.startWorkflow({ actor: "mcp:test", intent: "capture the MSO macOS desktop", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", first.workflow.id, {
      id: "a", tool: "screen_capture", state: "completed", durationMs: 1000, ts: new Date().toISOString(),
    });
    await memory.finishWorkflow({ actor: "mcp:test", summary: "captured", success: true });

    const second = await memory.startWorkflow({ actor: "mcp:test", intent: "kirim screenshot desktop macos mso", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", second.workflow.id, {
      id: "b", tool: "screen_capture", state: "completed", args: { shell: "macos", width: 1440, height: 900 },
      durationMs: 1800, ts: new Date().toISOString(),
    });
    const done = await memory.finishWorkflow({ actor: "mcp:test", summary: "captured with explicit dimensions", success: true });
    expect(done.recipe.fastestDurationMs).toBe(1000);
    expect(done.recipe.bestSteps[0].durationMs).toBe(1000);
    expect(done.recipe.bestSteps[0].args).toEqual({ shell: "macos", width: 1440, height: 900 });
  });

  it("stores redacted command shape rather than credential payloads", async () => {
    const started = await memory.startWorkflow({ actor: "mcp:test", intent: "run a scoped deployment command with token=top-secret" });
    expect(started.workflow.intent).not.toContain("top-secret");
    await memory.recordWorkflowStep("mcp:test", started.workflow.id, {
      id: "x", tool: "exec_run", state: "completed", durationMs: 20,
      target: "TOKEN=super-secret npm run build && curl https://x.test?a=1&token=abc",
      args: { command: "TOKEN=super-secret npm run build && curl https://x.test?a=1&token=abc", cwd: "/home/test/project", extra: "must-not-persist" },
      ts: new Date().toISOString(),
    });
    const done = await memory.finishWorkflow({ actor: "mcp:test", summary: "verified", success: true });
    const stored = JSON.stringify(done.recipe.bestSteps);
    expect(stored).not.toContain("super-secret");
    expect(stored).not.toContain("token=abc");
    expect(stored).not.toContain("must-not-persist");
    expect(done.recipe.bestSteps[0].args).toMatchObject({ cwd: "/home/test/project" });
  });

  it("keeps replayable allowlisted args but never write bodies", async () => {
    const started = await memory.startWorkflow({ actor: "mcp:test", intent: "write a project note" });
    await memory.recordWorkflowStep("mcp:test", started.workflow.id, {
      id: "w", tool: "fs_write", state: "completed", target: "/tmp/note.md",
      args: { path: "/tmp/note.md", content: "private body", mode: "unsafe" }, durationMs: 10, ts: new Date().toISOString(),
    });
    const done = await memory.finishWorkflow({ actor: "mcp:test", summary: "note verified", success: true });
    expect(done.recipe.bestSteps[0].args).toEqual({ path: "/tmp/note.md" });
    expect(JSON.stringify(done.recipe)).not.toContain("private body");
  });
});
