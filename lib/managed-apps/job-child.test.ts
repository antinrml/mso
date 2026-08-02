// How a job ENDS, which is the half that had no coverage: what happens when the
// child leaves something behind, and what the verdict is when we were the ones
// who killed it. Every child here is a Node stub in a temp $HOME — nothing in
// this file may touch the real Hermes/OpenClaw installs.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { startManagedAppJob, readManagedAppJob, cancelManagedAppJob } = await import("./jobs");
const { jobVerdict } = await import("./job-child");
import type { ManagedAppJob } from "./types";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-child-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

async function stub(name: string, body: string): Promise<string> {
  const file = path.join(home, `${name}.cjs`);
  await fs.writeFile(file, body);
  return file;
}

async function settle(jobId: string, tries = 500): Promise<ManagedAppJob> {
  for (let i = 0; i < tries; i += 1) {
    const job = await readManagedAppJob(jobId);
    if (job && job.status !== "queued" && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job never reached a terminal status");
}

async function waitForLog(jobId: string, needle: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if ((await readManagedAppJob(jobId))?.log.includes(needle)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`never saw ${needle} in the transcript`);
}

describe("a child that leaves something behind holding its output", () => {
  it(
    "still finishes the job and frees the app, instead of wedging the lock forever",
    async () => {
      // The shape of a real `openclaw update`: it restarts the gateway, and the
      // service it starts inherits the child's stdout. `close` waits for those
      // pipes to reach EOF, so it never fires — the job sat at `running` with
      // the lock held and every later action on the app answered 409, with no
      // cure short of restarting os-vps.
      const script = await stub(
        "leaks-a-daemon",
        `const { spawn } = require("child_process");
         spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit", detached: true }).unref();
         console.log("update applied, gateway restarted");
         process.exit(0);`,
      );
      const started = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] });

      const done = await settle(started.id);
      expect(done.status).toBe("succeeded"); // the child itself exited 0
      expect(done.log).toContain("update applied, gateway restarted");
      expect(done.log).toContain("still holds its output");
      // The point of the whole exercise: the app is usable again.
      const next = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, await stub("ok", "")] });
      expect((await settle(next.id)).status).toBe("succeeded");
    },
    30_000,
  );
});

describe("a child WE killed never reports success", () => {
  it("fails a job whose CLI trapped the signal and exited 0", async () => {
    // npm, pip and git all trap SIGTERM and exit cleanly. Taking the verdict
    // from the exit code alone therefore turned an update killed halfway into
    // "succeeded" — the one outcome where the operator most needs to be told to
    // roll back, and the one they would never see.
    const script = await stub(
      "traps-sigterm",
      `process.on("SIGTERM", () => { console.log("cleaning up"); process.exit(0); });
       console.log("halfway through");
       setTimeout(() => {}, 30000);`,
    );
    const started = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] });
    await waitForLog(started.id, "halfway through");

    expect(cancelManagedAppJob(started.id, "hermes")).toBe(true);
    const done = await settle(started.id);

    expect(done.status).toBe("failed");
    expect(done.exitCode).toBe(0); // it really did exit 0
    expect(done.error).toContain("cancelled by the operator");
  });

  it("says the same for a timeout, which is the same code path", () => {
    // The timeout's own wall clock is clamped to a 60 s minimum, so this is the
    // rule itself rather than an hour-long integration test.
    expect(jobVerdict("timed out after 3600s", 0, null).status).toBe("failed");
    expect(jobVerdict("timed out after 3600s", 0, null).error).toContain("timed out");
    expect(jobVerdict(null, 0, null).status).toBe("succeeded");
    expect(jobVerdict(null, 3, null).status).toBe("failed");
    expect(jobVerdict(null, null, "SIGKILL").status).toBe("failed");
  });
});

describe("what cancel refuses", () => {
  it("will not touch a job belonging to another app, an unknown id, or a finished one", async () => {
    const script = await stub("hold", "setTimeout(() => {}, 400);");
    const running = await startManagedAppJob({ applicationId: "openclaw", kind: "update", argv: [process.execPath, script] });

    expect(cancelManagedAppJob(running.id, "hermes")).toBe(false); // right job, wrong app
    expect(cancelManagedAppJob("0".repeat(24), "openclaw")).toBe(false);
    expect(cancelManagedAppJob("../../etc/passwd", "openclaw")).toBe(false);
    await settle(running.id);
    expect(cancelManagedAppJob(running.id, "openclaw")).toBe(false); // already over
  });

  it("will not abandon the mandatory pre-flight backup half-copied", async () => {
    // Before the child spawns there is nothing to signal, and stopping the
    // backup mid-copy destroys the very thing that makes the update reversible.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await startManagedAppJob({
      applicationId: "hermes",
      kind: "update",
      argv: [process.execPath, await stub("after-backup", 'console.log("ran");')],
      prepare: async (append) => {
        append("[os-vps] pre-update backup\n");
        await gate;
      },
    });
    await waitForLog(started.id, "pre-update backup");

    expect(cancelManagedAppJob(started.id, "hermes")).toBe(false);
    release();
    expect((await settle(started.id)).log).toContain("ran"); // and it carried on
  });
});
