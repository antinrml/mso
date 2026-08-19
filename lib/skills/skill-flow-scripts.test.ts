import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mso-skill-flow-"));
const createScript = path.join(process.cwd(), "scripts", "create-skill-flow.mjs");
const checkScript = path.join(process.cwd(), "scripts", "check-skill-flows.mjs");
const skillFile = path.join(temp, "mso-generated-test", "SKILL.md");

const command = (script: string, args: string[]) => run(process.execPath, [script, ...args], { cwd: process.cwd() });

afterAll(async () => { await fs.rm(temp, { recursive: true, force: true }); });

describe("workflow skill factory", () => {
  it("creates once, leaves explicit guidance placeholders, and refuses overwrite", async () => {
    const args = [
      "--name", "mso-generated-test",
      "--description", "Route a generated test through safe tools and verified outcomes.",
      "--risk", "low",
      "--policy", "inspect-verify",
      "--root", temp,
    ];
    await expect(command(createScript, args)).resolves.toMatchObject({ stdout: expect.stringContaining("created") });
    const source = await fs.readFile(skillFile, "utf8");
    expect(source).toContain("{{USE_WHEN}}");
    expect(source).toContain("{{EXPECTED_STATE}}");
    await expect(command(createScript, args)).rejects.toMatchObject({
      stderr: expect.stringContaining("already exists"),
    });
  });

  it("fails closed until the generated workflow is made specific", async () => {
    await expect(command(checkScript, ["--root", temp])).rejects.toMatchObject({
      stderr: expect.stringContaining("unresolved template placeholder"),
    });
    const source = await fs.readFile(skillFile, "utf8");
    await fs.writeFile(skillFile, source.replace(/{{(?:USE_WHEN|DO_NOT_USE|REQUIRED_CONTEXT|EXPECTED_STATE|TARGETED_CHECKS|RUNTIME_PROOF|VISUAL_PROOF|DIFF_BOUNDARY)}}/g, "Explicit reviewed workflow guidance."));
    await expect(command(checkScript, ["--root", temp])).resolves.toMatchObject({
      stdout: expect.stringContaining("1 official skills valid"),
    });
  });
});
