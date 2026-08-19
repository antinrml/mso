import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { ActiveWorkflow } from "./memory";

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
    const one = await memory.finishWorkflow({ actor: "mcp:test", workflowId: first.workflow.id, summary: "screenshot and authenticated link verified", success: true });
    expect(one.recipe.fastestDurationMs).toBe(5000);

    const second = await memory.startWorkflow({ actor: "mcp:test", intent: "kirim screenshot macos dengan temporary download link", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", second.workflow.id, {
      id: "b", tool: "screen_capture", state: "completed", args: { shell: "macos", width: 1440, height: 900 }, durationMs: 2200, ts: new Date().toISOString(),
    });
    const two = await memory.finishWorkflow({ actor: "mcp:test", workflowId: second.workflow.id, summary: "same result in one faster call", success: true });
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
    await memory.finishWorkflow({ actor: "mcp:test", workflowId: first.workflow.id, summary: "captured", success: true });

    const second = await memory.startWorkflow({ actor: "mcp:test", intent: "kirim screenshot desktop macos mso", project: "mso" });
    await memory.recordWorkflowStep("mcp:test", second.workflow.id, {
      id: "b", tool: "screen_capture", state: "completed", args: { shell: "macos", width: 1440, height: 900 },
      durationMs: 1800, ts: new Date().toISOString(),
    });
    const done = await memory.finishWorkflow({ actor: "mcp:test", workflowId: second.workflow.id, summary: "captured with explicit dimensions", success: true });
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
    const done = await memory.finishWorkflow({ actor: "mcp:test", workflowId: started.workflow.id, summary: "verified", success: true });
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
    const done = await memory.finishWorkflow({ actor: "mcp:test", workflowId: started.workflow.id, summary: "note verified", success: true });
    expect(done.recipe.bestSteps[0].args).toEqual({ path: "/tmp/note.md" });
    expect(JSON.stringify(done.recipe)).not.toContain("private body");
  });

  it("keeps parallel workflows isolated and requires exact ids to cancel or finish", async () => {
    const first = await memory.startWorkflow({ actor: "mcp:shared", intent: "first conversation task" });
    const second = await memory.startWorkflow({ actor: "mcp:shared", intent: "second conversation task" });
    expect(second.workflow.id).not.toBe(first.workflow.id);
    await expect(memory.activeWorkflowForActor("mcp:shared", first.workflow.id)).resolves.toMatchObject({ id: first.workflow.id });
    await expect(memory.activeWorkflowForActor("mcp:shared", second.workflow.id)).resolves.toMatchObject({ id: second.workflow.id });
    await expect(memory.activeWorkflowForActor("mcp:shared")).resolves.toBeNull();
    await expect(memory.finishWorkflow({
      actor: "mcp:shared", workflowId: "wrong", summary: "wrong conversation", success: true,
    })).rejects.toThrow("workflow_id was not found");
    await expect(memory.cancelWorkflow({ actor: "mcp:shared", workflowId: "wrong" }))
      .rejects.toThrow("workflow_id was not found");

    const cancelled = await memory.cancelWorkflow({
      actor: "mcp:shared", workflowId: first.workflow.id, reason: "request was interrupted",
    });
    expect(cancelled).toMatchObject({ workflow: { id: first.workflow.id }, reason: "request was interrupted" });
    await expect(memory.activeWorkflowForActor("mcp:shared", first.workflow.id)).resolves.toBeNull();
    await expect(memory.activeWorkflowForActor("mcp:shared", second.workflow.id)).resolves.toMatchObject({ id: second.workflow.id });
    await expect(memory.finishWorkflow({
      actor: "mcp:shared", workflowId: second.workflow.id, summary: "verified second task", success: true,
    })).resolves.toMatchObject({ workflow: { id: second.workflow.id } });
  });

  it("grants distinct ids when workflow starts race on a cold store", async () => {
    const [first, second] = await Promise.all([
      memory.startWorkflow({ actor: "mcp:cold-race", intent: "first concurrent task" }),
      memory.startWorkflow({ actor: "mcp:cold-race", intent: "second concurrent task" }),
    ]);
    expect(second.workflow.id).not.toBe(first.workflow.id);
    await expect(memory.activeWorkflowForActor("mcp:cold-race", first.workflow.id)).resolves.toMatchObject({ id: first.workflow.id });
    await expect(memory.activeWorkflowForActor("mcp:cold-race", second.workflow.id)).resolves.toMatchObject({ id: second.workflow.id });
  });

  it("migrates a live v1 actor workflow into an exact-id v2 bucket", async () => {
    const legacy: ActiveWorkflow = {
      id: "legacy-workflow", actor: "mcp:legacy", intent: "finish the pre-deploy task",
      project: "~/projects/mso", startedAt: new Date().toISOString(), steps: [],
    };
    await fs.writeFile(process.env.OS_SKILL_MEMORY_STORE!, JSON.stringify({
      version: 1, active: { "mcp:legacy": legacy }, recipes: {},
    }));
    memory.resetSkillMemoryCache();
    await expect(memory.activeWorkflowForActor("mcp:legacy", legacy.id)).resolves.toMatchObject({ id: legacy.id });

    const current = await memory.startWorkflow({ actor: "mcp:legacy", intent: "new parallel task" });
    expect(current.activeWorkflowCount).toBe(2);
    const stored = JSON.parse(await fs.readFile(process.env.OS_SKILL_MEMORY_STORE!, "utf8")) as {
      version: number; active: Record<string, Record<string, ActiveWorkflow>>;
    };
    expect(stored.version).toBe(2);
    expect(stored.active["mcp:legacy"][legacy.id]).toMatchObject({ intent: legacy.intent });
    expect(stored.active["mcp:legacy"][current.workflow.id]).toMatchObject({ intent: "new parallel task" });
  });


  it("compresses a long successful trace into a bounded replay route", async () => {
    const started = await memory.startWorkflow({ actor: "mcp:compact", intent: "inspect, update and prove a large repository change" });
    for (let i = 0; i < 45; i += 1) {
      await memory.recordWorkflowStep("mcp:compact", started.workflow.id, {
        id: `read-${i}`, tool: "fs_read", state: "completed", target: `/repo/file-${i}.ts`,
        args: { path: `/repo/file-${i}.ts` }, durationMs: 1, ts: new Date().toISOString(),
      });
    }
    await memory.recordWorkflowStep("mcp:compact", started.workflow.id, {
      id: "failed", tool: "exec_run", state: "failed", target: "bad command", durationMs: 1, ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:compact", started.workflow.id, {
      id: "write", tool: "fs_write", state: "completed", target: "/repo/result.ts",
      args: { path: "/repo/result.ts", content: "private" }, durationMs: 2, ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:compact", started.workflow.id, {
      id: "verify", tool: "exec_run", state: "completed", target: "bun run verify",
      args: { command: "bun run verify", cwd: "/repo" }, durationMs: 3, ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:compact", started.workflow.id, {
      id: "proof", tool: "screen_capture", state: "completed", target: "dashboard",
      args: { shell: "dashboard", width: 1440, height: 900 }, durationMs: 4, ts: new Date().toISOString(),
    });
    const done = await memory.finishWorkflow({
      actor: "mcp:compact", workflowId: started.workflow.id, summary: "change verified", success: true,
    });
    expect(done.recipe.lastSteps).toHaveLength(49);
    expect(done.recipe.bestSteps.length).toBeLessThanOrEqual(24);
    expect(done.recipe.bestSteps.every((step) => step.state === "completed")).toBe(true);
    expect(done.recipe.bestSteps.map((step) => step.tool)).toEqual(expect.arrayContaining(["fs_write", "exec_run", "screen_capture"]));
    expect(done.recipe.bestSteps.some((step) => step.id === "failed")).toBe(false);
  });

});
