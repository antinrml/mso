// Starting an operation, and what to do when the lock refuses it. Lifted out of
// the hook so the whole path is testable without a DOM: `dispatch` is passed in
// and every fetch goes through update-api.
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { apiMessage, listJobs, UpdateApiError, type ActionResult, type JobView, type UpdateStatus } from "./update-api";
import type { JobEvent } from "./update-machine";

type Dispatch = (event: JobEvent) => void;

/** The one job a 409 could be about: still live, and this app's.
 *
 *  Deliberately narrow, because adopting a job means rendering its transcript
 *  and then reporting its outcome as the operator's:
 *   • a terminal record is never adopted — the lock it held is gone, so it
 *     cannot be what refused this request, and "succeeded" would be a lie about
 *     an operation that never started;
 *   • a record that names a DIFFERENT app is never adopted even though the
 *     route only lists this one's, and neither is one that names no app at all.
 *  When several qualify (they should not — the lock is per app) the newest
 *  wins: `GET /jobs` is newest-first, so that is simply the first match. */
export function liveJobFor(jobs: readonly JobView[], appId: ManagedAppId): JobView | null {
  return jobs.find((job) => job.applicationId === appId && (job.status === "running" || job.status === "queued")) ?? null;
}

const isConflict = (cause: unknown): boolean => cause instanceof UpdateApiError && cause.status === 409;

/** Start an operation and hand the machine the job it produced. Returns the
 *  status when the action answered inline instead of with a job — the caller
 *  owns that state, so it is the one outcome handed back rather than dispatched.
 *
 *  A 409 is the manager's operation lock, and the panel must not render it as
 *  "this update failed". It is the answer to a double-submit, and to a retried
 *  POST whose 202 was lost — in both cases an update IS running, restarting the
 *  operator's service, and reporting failure would stop the poll loop and hide
 *  it until the window was closed and reopened. So on 409 we ask the server
 *  which job holds the lock and adopt it; only if there is no live job of ours
 *  to adopt is the refusal real, and then it is shown verbatim. */
export async function startAction(
  appId: ManagedAppId,
  kind: string,
  call: () => Promise<ActionResult>,
  dispatch: Dispatch,
): Promise<UpdateStatus | null> {
  dispatch({ type: "start", kind });
  try {
    const result = await call();
    if (result.jobId) dispatch({ type: "started", jobId: result.jobId });
    // Some actions (a channel switch that only rewrites config) finish inside
    // the request and answer with the new status instead of a job.
    else if (result.status) {
      dispatch({ type: "reset" });
      return result.status;
    } else dispatch({ type: "rejected", message: "the server accepted the request but returned no job id" });
  } catch (cause) {
    // `listJobs` failing here must not replace the 409 with a list error: the
    // operator needs the reason the operation was refused, not our second try.
    const running = isConflict(cause) ? liveJobFor(await listJobs(appId).catch(() => []), appId) : null;
    if (running) dispatch({ type: "adopt", job: running });
    else dispatch({ type: "rejected", message: apiMessage(cause) });
  }
  return null;
}
