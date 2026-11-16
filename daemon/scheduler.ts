import { dueTimers, earliestDue, fire } from "./timers.ts";
import type { Deps } from "./worker.ts";

const longestWait = 5 * 60_000;

export function startScheduler({ db }: Deps, wake: () => void): () => void {
  let timeout: NodeJS.Timeout | undefined;
  function rearm(): void {
    clearTimeout(timeout);
    const now = Date.now();
    const due = dueTimers(db, now);
    for (const timer of due) fire(db, timer, now);
    if (due.length > 0) wake();
    timeout = setTimeout(rearm, Math.min(longestWait, (earliestDue(db) ?? Infinity) - now));
  }
  rearm();
  return rearm;
}
