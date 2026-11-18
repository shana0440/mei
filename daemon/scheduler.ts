import { earliestWaiting } from "./inbox.ts";
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
    wake();
    const nextAt = Math.min(earliestDue(db) ?? Infinity, earliestWaiting(db, now) ?? Infinity);
    timeout = setTimeout(rearm, Math.min(longestWait, nextAt - now));
  }
  rearm();
  return rearm;
}
