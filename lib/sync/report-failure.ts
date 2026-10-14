import { reportClientError } from "@/lib/error-reporter";

/** Rejection handler for a sync the UI starts without awaiting its result
 *  (`void triggerSync(...).catch(reportSyncFailure)`; likewise for
 *  `resolveConflictsKeepingLocal` and `discardPendingChanges`).
 *
 *  By the time the promise rejects the engine has already put the failure
 *  on the status pill (and signed the user out on an auth failure), so the
 *  UI has nothing left to do with it. It is forwarded to the client error
 *  reporter rather than left as an unhandled rejection or dropped, as a
 *  warning: the user already sees it and the next sync retries. */
export function reportSyncFailure(err: unknown): void {
  reportClientError(err, { route: "sync", level: "warning" });
}
