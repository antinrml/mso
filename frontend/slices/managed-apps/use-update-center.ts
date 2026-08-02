"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { liveJobFor, startAction } from "./start-action";
import {
  apiMessage,
  cancelJob,
  checkForUpdate,
  getJob,
  getUpdateStatus,
  listJobs,
  type ActionResult,
  type UpdateStatus,
} from "./update-api";
import { IDLE_JOB, isActive, isTerminal, jobReducer, POLL_INTERVAL_MS, type JobState } from "./update-machine";

export interface UpdateCentre {
  status: UpdateStatus | null;
  statusError: string | null;
  loading: boolean;
  checking: boolean;
  job: JobState;
  check: () => void;
  /** Starts a job from any action call and hands the machine the id — or, when
   *  the lock refuses it (409), adopts the job that holds it (start-action.ts). */
  run: (kind: string, call: () => Promise<ActionResult>) => Promise<void>;
  /** Ends a job that is not ending on its own, so the app's lock is released.
   *  Null while nothing is running — the button is not offered then. */
  cancel: (() => Promise<void>) | null;
  dismiss: () => void;
}

/** Drives one app's update panel: status, the running job, and the poll loop.
 *  The loop lives in an effect, so closing the window (unmount) stops it — and
 *  it stops itself the moment the job reaches a terminal status. */
export function useUpdateCentre(appId: ManagedAppId, onSettled?: () => void): UpdateCentre {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [job, dispatch] = useReducer(jobReducer, IDLE_JOB);

  // The cursor must not be an effect dependency (it moves on every poll and
  // would re-arm the loop), so the loop reads it from a ref. Both refs are
  // written in an effect, never during render — the next tick is 2 s away, so
  // "one commit late" is never observable.
  const cursor = useRef(0);
  const settled = useRef(onSettled);
  useEffect(() => {
    cursor.current = job.cursor;
    settled.current = onSettled;
  });

  const loadStatus = useCallback(async (signal?: AbortSignal): Promise<UpdateStatus | null> => {
    try {
      const next = await getUpdateStatus(appId, signal);
      setStatus(next);
      setStatusError(null);
      return next;
    } catch (cause) {
      if (!signal?.aborted) setStatusError(apiMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [appId]);

  /** The explicit probe. A POST, because probing SPAWNS the app's CLI (and
   *  git-fetches, for Hermes) — `GET /update` is a cache read and never runs
   *  anything, which is what keeps a side effect off a cross-origin-reachable
   *  verb. */
  const check = useCallback(() => {
    setChecking(true);
    void checkForUpdate(appId)
      .then((result) => {
        if (result.jobId) dispatch({ type: "started", jobId: result.jobId });
        else if (result.status) setStatus(result.status);
        else throw new Error("the server returned no update status");
        setStatusError(null);
      })
      .catch((cause: unknown) => setStatusError(apiMessage(cause)))
      .finally(() => setChecking(false));
  }, [appId]);

  // Mount: status, plus any job that was already running before this window
  // opened. An update outlives the window that started it, so adopting is the
  // difference between "still updating" and a blank panel.
  // Deferred a tick, like the card's own poller: a fetch kicked off straight
  // from an effect body reads as a synchronous setState to the lint rule.
  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      // `checkedAt: null` = this server has never probed the app, so the read
      // returned an empty shell. One probe then — the cache serves every later
      // window, and the operator's Check button forces a fresh one.
      void loadStatus(abort.signal).then((status) => {
        if (status && !status.checkedAt && !status.error && !abort.signal.aborted) check();
      });
      void listJobs(appId)
        .then((jobs) => {
          const live = liveJobFor(jobs, appId);
          if (live && !abort.signal.aborted) dispatch({ type: "adopt", job: live });
        })
        .catch(() => {
          /* no history endpoint yet, or none to adopt — the panel still works */
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [appId, check, loadStatus]);

  useEffect(() => {
    if (!job.jobId || !isActive(job.phase)) return;
    const jobId = job.jobId;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const next = await getJob(appId, jobId, cursor.current);
        if (!alive) return;
        if (next) dispatch({ type: "polled", job: next });
        else dispatch({ type: "vanished" });
      } catch (cause) {
        if (alive) dispatch({ type: "poll-failed", message: apiMessage(cause) });
      }
      if (alive) timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void tick(), 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [appId, job.jobId, job.phase]);

  // A finished job changed the installed version (or removed the app), so the
  // card and the status both have to be re-read rather than assumed. A PROBE,
  // not the cached read: the cache still holds the version this job replaced.
  useEffect(() => {
    if (!isTerminal(job.phase)) return;
    const timer = window.setTimeout(() => {
      check();
      settled.current?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [job.phase, check]);

  const run = useCallback(async (kind: string, call: () => Promise<ActionResult>) => {
    const inline = await startAction(appId, kind, call, dispatch);
    if (inline) setStatus(inline);
  }, [appId]);

  const dismiss = useCallback(() => dispatch({ type: "reset" }), []);

  // Only offered for a job this panel knows is running. The server refuses while
  // the job is still inside its mandatory pre-flight backup, and the poll loop
  // reports the outcome — so this never has to guess whether it worked.
  const running = isActive(job.phase) ? job.jobId : null;
  const cancel = useCallback(async () => {
    if (!running) return;
    try {
      await cancelJob(appId, running);
    } catch (cause) {
      dispatch({ type: "poll-failed", message: apiMessage(cause) });
    }
  }, [appId, running]);

  return { status, statusError, loading, checking, job, check, run, cancel: running ? cancel : null, dismiss };
}
