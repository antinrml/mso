import "server-only";
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { childEnv } from "@/lib/host/child-env";
import type { ManagedAppJobStatus, StartManagedAppJobOptions } from "./types";

// The child half of the job layer: spawning it, bounding it, and — the part
// that cost a permanently wedged lock to learn — REAPING it. job-runner.ts owns
// the record and the transcript; nothing here touches either directly.
//
// `close` is not "the child exited". It fires when the child has exited AND
// every stdio pipe it was given has reached EOF, and an update routinely leaves
// something behind holding those pipes: `openclaw update` restarts the gateway,
// npm leaves helpers, a service the updater started inherits the same stdout.
// Waiting on `close` alone therefore left the job `running` FOREVER — with the
// app's operation lock held, so every later action on that app 409'd, and the
// only cure was restarting os-vps (which the docs tell the operator not to do
// mid-update). Reproduced by killing the child's group exactly as the timeout
// does: the child is reaped, the grandchild keeps the pipe, the job never ends.
//
// So: `exit` is the authority on the verdict, `close` is only a chance to
// collect the last bytes, and the wait between them is bounded.

export const MANAGED_APP_JOB_DEFAULT_TIMEOUT_MS = 1_800_000;
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 3_600_000;
const KILL_GRACE_MS = 10_000;
/** How long after the child itself exits we keep draining its pipes before
 *  finishing the job anyway. Long enough that a normal child — whose pipes hit
 *  EOF in the same tick — never loses a byte of output; short enough that a
 *  leaked grandchild costs seconds instead of the operator's whole session. */
const REAP_GRACE_MS = 5_000;
// stdin closed: a CLI that prompts anyway (a missed --yes, a confirmation
// upstream just added) gets EOF and exits, instead of blocking for the whole
// timeout with nobody able to answer it.
const JOB_STDIO: StdioOptions = ["ignore", "pipe", "pipe"];

/** What job-runner.ts lends the child: somewhere to put output, somewhere to
 *  put the verdict, and a handle on the kill switch so a job can be cancelled. */
export interface ChildHooks {
  append: (text: string) => void;
  finish: (status: ManagedAppJobStatus, exitCode: number | null, error: string | null) => void;
  /** Called once with the terminator, before anything can go wrong. */
  register: (terminate: (why: string) => void) => void;
}

/** The verdict, stated in one place because the rule that matters is easy to
 *  lose in a listener: a child WE terminated has FAILED, whatever it exited
 *  with. Deriving it from the exit code alone let a timed-out update report
 *  "succeeded" — npm, pip and git all trap SIGTERM and exit 0 on their way out,
 *  and an update killed halfway is precisely where a false success costs most,
 *  because the operator is never told to roll back. */
export function jobVerdict(
  terminated: string | null,
  code: number | null,
  signal: NodeJS.Signals | null,
): { status: ManagedAppJobStatus; error: string | null } {
  if (terminated) return { status: "failed", error: `${terminated} (exit ${signal ?? code ?? "unknown"})` };
  if (signal) return { status: "failed", error: `terminated by ${signal}` };
  return code === 0 ? { status: "succeeded", error: null } : { status: "failed", error: `exited with code ${code}` };
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal); // the whole group: git/pip/npm do the work
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/** Spawn the job's child and resolve once its outcome is known — never later,
 *  whatever it leaves running behind it. */
export function spawnJobChild(argv: readonly string[], options: StartManagedAppJobOptions, hooks: ChildHooks): Promise<void> {
  const [program, ...args] = argv;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? MANAGED_APP_JOB_DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      // NO_COLOR/TERM: the transcript is stored and rendered as plain text, so
      // ANSI would only eat the cap.
      env: { ...(childEnv() as NodeJS.ProcessEnv), NO_COLOR: "1", TERM: "dumb", ...options.env },
      stdio: JOB_STDIO,
      detached: true,
      shell: false,
    });
    let terminated: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    let reaper: NodeJS.Timeout | undefined;

    const done = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      clearTimeout(reaper);
      const { status, error } = jobVerdict(terminated, code, signal);
      hooks.finish(status, code, error);
      resolve();
    };
    /** SIGTERM the whole group, SIGKILL what ignores it — and REMEMBER that we
     *  did, which is what keeps the verdict honest. */
    const terminate = (why: string): void => {
      if (terminated) return;
      terminated = why;
      hooks.append(`[os-vps] ${why} - terminating\n`);
      signalTree(child, "SIGTERM");
      setTimeout(() => signalTree(child, "SIGKILL"), KILL_GRACE_MS).unref?.();
    };
    hooks.register(terminate);

    child.stdout?.on("data", (chunk: Buffer) => hooks.append(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => hooks.append(chunk.toString("utf8")));
    timer = setTimeout(() => terminate(`timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(reaper);
      hooks.finish("failed", null, error.message); // ENOENT: the CLI is not installed
      resolve();
    });
    child.on("exit", (code, signal) => {
      // The child is gone; only its pipes might not be. Wait a moment for the
      // tail of its output, then finish regardless — see the header.
      reaper = setTimeout(() => {
        hooks.append(`[os-vps] the child exited but something it started still holds its output; finishing anyway\n`);
        child.stdout?.destroy();
        child.stderr?.destroy();
        done(code, signal);
      }, REAP_GRACE_MS);
      reaper.unref?.();
    });
    child.on("close", (code, signal) => done(code, signal));
  });
}
