// The 409 path. A rejected duplicate request used to be rendered as the failure
// of the operation that actually started: `run()` cleared the job id, the throw
// became `rejected`, and the panel said "update failed: another operation is
// already running" while a real update was at that moment restarting the
// operator's service — with the poll loop stopped and no way back but closing
// the window. These tests are that scenario, from both ends.
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveJobFor, startAction } from "./start-action";
import { UpdateApiError, type ActionResult, type JobView } from "./update-api";
import { jobReducer, IDLE_JOB, type JobEvent } from "./update-machine";

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

/** Only `GET /jobs` is stubbed: the ACTION is the `call` argument. */
function stubJobs(jobs: JobView[] | Error) {
  const fetchMock = vi.fn(async () => {
    if (jobs instanceof Error) return { ok: false, status: 500, json: async () => ({ error: jobs.message }) };
    return { ok: true, status: 200, json: async () => ({ jobs }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const record = () => {
  const events: JobEvent[] = [];
  return { events, dispatch: (event: JobEvent) => void events.push(event) };
};

const conflict = () => Promise.reject(new UpdateApiError("another operation is already running", 409));
const accepted = (jobId: string): Promise<ActionResult> => Promise.resolve({ jobId, status: null });

afterEach(() => vi.unstubAllGlobals());

describe("a 409 adopts the operation that is actually running", () => {
  it("shows the live job instead of reporting the double-submit as its failure", async () => {
    const running = job({ id: "b".repeat(24), kind: "uninstall" });
    stubJobs([running]);
    const { events, dispatch } = record();

    await startAction("hermes", "uninstall", conflict, dispatch);

    expect(events.map((event) => event.type)).toEqual(["start", "adopt"]);
    // The panel now follows the job that holds the lock: right id, right kind,
    // and a phase the poll loop keeps polling.
    const state = events.reduce(jobReducer, IDLE_JOB);
    expect(state).toMatchObject({ phase: "running", jobId: "b".repeat(24), kind: "uninstall", error: null });
  });

  it("still reports the refusal when there is no live job to adopt", async () => {
    // Same 409, nothing running: the lock was released between the POST and the
    // list, or something else refused. That IS a failure, and it is shown.
    stubJobs([job({ status: "succeeded", endedAt: "2026-07-25T10:09:00.000Z" })]);
    const { events, dispatch } = record();

    await startAction("hermes", "update", conflict, dispatch);

    expect(events.at(-1)).toEqual({ type: "rejected", message: "another operation is already running" });
  });

  it("never adopts a finished job, whatever the list says", () => {
    for (const status of ["succeeded", "failed", "interrupted"] as const) {
      // A terminal record cannot be holding the lock, and reporting its outcome
      // as this request's would be a lie about an operation that never started.
      expect(liveJobFor([job({ status })], "hermes")).toBeNull();
    }
    expect(liveJobFor([job({ status: "queued" })], "hermes")).not.toBeNull();
  });

  it("never adopts another app's job, or one that names no app", () => {
    // The route only lists this app's jobs; this is the second lock on that,
    // because adopting a job means rendering its transcript in this window.
    expect(liveJobFor([job({ applicationId: "openclaw" })], "hermes")).toBeNull();
    expect(liveJobFor([job({ applicationId: null })], "hermes")).toBeNull();
    // Newest-first from the route, so the first match is the newest one.
    const mine = job({ id: "c".repeat(24) });
    expect(liveJobFor([job({ applicationId: "openclaw" }), mine], "hermes")).toBe(mine);
  });

  it("keeps the 409 message when the job list itself fails", async () => {
    stubJobs(new Error("gateway timeout"));
    const { events, dispatch } = record();

    await startAction("openclaw", "restore", conflict, dispatch);

    // The operator needs why the operation was refused, not why our second
    // request failed.
    expect(events.at(-1)).toEqual({ type: "rejected", message: "another operation is already running" });
  });

  it("does not go looking for a job when the refusal was not a conflict", async () => {
    const fetchMock = stubJobs([job()]);
    const { events, dispatch } = record();

    await startAction("hermes", "update", () => Promise.reject(new UpdateApiError("session expired", 401)), dispatch);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "rejected", message: "session expired" });
  });
});

describe("the ordinary paths are unchanged", () => {
  it("starts the job the server accepted", async () => {
    const { events, dispatch } = record();
    expect(await startAction("hermes", "update", () => accepted("d".repeat(24)), dispatch)).toBeNull();
    expect(events).toEqual([{ type: "start", kind: "update" }, { type: "started", jobId: "d".repeat(24) }]);
  });

  it("hands back an inline status and clears the machine", async () => {
    const status = { currentVersion: "2026.7.1-2" } as never;
    const { events, dispatch } = record();

    expect(await startAction("openclaw", "switch to beta", () => Promise.resolve({ jobId: null, status }), dispatch)).toBe(status);
    expect(events.at(-1)).toEqual({ type: "reset" });
  });

  it("says so when the server accepts but names no job", async () => {
    const { events, dispatch } = record();
    await startAction("hermes", "update", () => Promise.resolve({ jobId: null, status: null }), dispatch);
    expect(events.at(-1)).toMatchObject({ type: "rejected" });
  });
});
