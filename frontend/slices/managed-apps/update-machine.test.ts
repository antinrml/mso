import { describe, expect, it } from "vitest";
import type { JobView } from "./update-api";
import {
  CLIENT_LOG_CAP,
  IDLE_JOB,
  isActive,
  isTerminal,
  jobReducer,
  statusLine,
  type JobEvent,
  type JobState,
} from "./update-machine";

const job = (over: Partial<JobView> = {}): JobView => ({
  id: "a".repeat(24),
  applicationId: "hermes",
  kind: "update",
  status: "running",
  exitCode: null,
  error: null,
  log: "",
  logOffset: 0,
  startedAt: "2026-07-25T10:00:00.000Z",
  endedAt: null,
  ...over,
});

const play = (events: JobEvent[], from: JobState = IDLE_JOB): JobState => events.reduce(jobReducer, from);

describe("idle → running → terminal", () => {
  it("walks idle → starting → running → succeeded", () => {
    const started = play([{ type: "start", kind: "update" }]);
    expect(started.phase).toBe("starting");
    expect(isActive(started.phase)).toBe(true);

    const running = jobReducer(started, { type: "started", jobId: "b".repeat(24) });
    expect(running).toMatchObject({ phase: "running", jobId: "b".repeat(24) });

    const done = jobReducer(running, { type: "polled", job: job({ status: "succeeded", exitCode: 0, endedAt: "2026-07-25T10:09:00.000Z" }) });
    expect(done).toMatchObject({ phase: "succeeded", exitCode: 0, endedAt: "2026-07-25T10:09:00.000Z" });
    expect(isTerminal(done.phase)).toBe(true);
  });

  it("treats queued as running — the operator sees one 'in flight'", () => {
    expect(jobReducer(IDLE_JOB, { type: "polled", job: job({ status: "queued" }) }).phase).toBe("running");
  });

  it("keeps a failed job's reason and exit code", () => {
    const failed = jobReducer(IDLE_JOB, { type: "polled", job: job({ status: "failed", exitCode: 1, error: "npm ERR! 404" }) });
    expect(failed).toMatchObject({ phase: "failed", exitCode: 1, error: "npm ERR! 404" });
    expect(statusLine(failed)).toContain("npm ERR! 404");
  });

  it("reads interrupted as a dead watcher, not a spinner and not a clean failure", () => {
    const state = play([
      { type: "start", kind: "update" },
      { type: "started", jobId: "c".repeat(24) },
      { type: "polled", job: job({ status: "interrupted", error: "server restarted" }) },
    ]);
    expect(state.phase).toBe("interrupted");
    expect(isActive(state.phase)).toBe(false);
    expect(isTerminal(state.phase)).toBe(true);
    expect(statusLine(state)).toMatch(/interrupted/i);
    expect(statusLine(state)).toMatch(/half-applied/);
  });

  it("ends failed when the POST itself is refused — a rejected start spawns nothing", () => {
    // This is what a failed pre-update backup looks like from here: the job
    // never reaches `running`, so no child ever ran.
    const state = play([
      { type: "start", kind: "update" },
      { type: "rejected", message: "another operation is already running" },
    ]);
    expect(state).toMatchObject({ phase: "failed", jobId: null, exitCode: null });
    expect(state.error).toBe("another operation is already running");
  });

  it("adopts a job that was already running when the window opened", () => {
    const state = jobReducer(IDLE_JOB, { type: "adopt", job: job({ kind: "restore", log: "restoring\n", logOffset: 10 }) });
    expect(state).toMatchObject({ phase: "running", kind: "restore", cursor: 10, log: "restoring\n" });
  });

  it("adopts a log-free summary without skipping the transcript", () => {
    // GET /jobs strips `log` but keeps `logOffset`. Taking that offset as the
    // cursor would jump past everything already printed and blame the log cap.
    const state = jobReducer(IDLE_JOB, { type: "adopt", job: job({ log: "", logOffset: 4096 }) });
    expect(state).toMatchObject({ phase: "running", cursor: 0, log: "" });
    // The first poll (since=0) then delivers the tail the server still holds.
    const polled = jobReducer(state, { type: "polled", job: job({ log: "resuming\n", logOffset: 9 }) });
    expect(polled.log).toBe("resuming\n");
    expect(polled.cursor).toBe(9);
  });

  it("resets to idle on dismiss", () => {
    expect(jobReducer(play([{ type: "start", kind: "update" }]), { type: "reset" })).toEqual(IDLE_JOB);
  });
});

describe("log accumulation", () => {
  it("appends each since-slice and tracks the server's cursor", () => {
    const state = play([
      { type: "polled", job: job({ log: "one\n", logOffset: 4 }) },
      { type: "polled", job: job({ log: "two\n", logOffset: 8 }) },
    ]);
    expect(state.log).toBe("one\ntwo\n");
    expect(state.cursor).toBe(8);
  });

  it("advances its own cursor when the route omits logOffset", () => {
    const state = play([
      { type: "polled", job: job({ log: "one\n" }) },
      { type: "polled", job: job({ log: "two\n" }) },
    ]);
    expect(state.cursor).toBe(8);
    expect(state.log).toBe("one\ntwo\n");
  });

  it("marks the hole when the server's cap dropped bytes we never read", () => {
    // logOffset 5000 with a 100-char tail means the chunk starts at 4900, but
    // we had only read 10 — 4890 chars are simply gone.
    const state = play([
      { type: "polled", job: job({ log: "0123456789", logOffset: 10 }) },
      { type: "polled", job: job({ log: "x".repeat(100), logOffset: 5000 }) },
    ]);
    expect(state.log).toContain("… 4890 characters dropped by the log cap …");
    expect(state.cursor).toBe(5000);
  });

  it("keeps the tail once the client cap is passed", () => {
    const state = play([
      { type: "polled", job: job({ log: "HEAD" + "y".repeat(CLIENT_LOG_CAP), logOffset: CLIENT_LOG_CAP + 4 }) },
    ]);
    expect(state.log).toHaveLength(CLIENT_LOG_CAP);
    expect(state.log.startsWith("HEAD")).toBe(false);
    expect(state.log.endsWith("y")).toBe(true);
  });
});

describe("polling faults", () => {
  it("stays quiet about one blip, then says contact was lost — without lying about the job", () => {
    let state = play([{ type: "start", kind: "update" }, { type: "started", jobId: "d".repeat(24) }]);
    state = jobReducer(state, { type: "poll-failed", message: "network error" });
    expect(state.phase).toBe("running");
    expect(state.warning).toBeNull();

    state = play([{ type: "poll-failed", message: "network error" }, { type: "poll-failed", message: "network error" }], state);
    expect(state.misses).toBe(3);
    expect(state.warning).toMatch(/may still be running on the host/);
    expect(state.phase).toBe("running");
  });

  it("clears the warning as soon as a poll lands", () => {
    const state = play([
      { type: "started", jobId: "e".repeat(24) },
      { type: "poll-failed", message: "x" },
      { type: "poll-failed", message: "x" },
      { type: "poll-failed", message: "x" },
      { type: "polled", job: job({ log: "back\n", logOffset: 5 }) },
    ]);
    expect(state.warning).toBeNull();
    expect(state.misses).toBe(0);
  });

  it("fails loudly when the record itself vanishes", () => {
    const state = jobReducer(play([{ type: "started", jobId: "f".repeat(24) }]), { type: "vanished" });
    expect(state.phase).toBe("failed");
    expect(state.error).toMatch(/gone/);
  });
});

describe("statusLine", () => {
  it("says nothing is running when idle", () => {
    expect(statusLine(IDLE_JOB)).toBe("No update job is running.");
  });

  it("names the action the operator picked", () => {
    expect(statusLine(play([{ type: "start", kind: "dry run" }]))).toBe("Starting dry run…");
    expect(statusLine(play([{ type: "start", kind: "restore" }, { type: "started", jobId: "g".repeat(24) }]))).toMatch(/restarts the service/);
  });
});
