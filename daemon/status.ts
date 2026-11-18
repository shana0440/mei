import { request, runCommand } from "./client.ts";
import type { InboxEvent } from "./inbox.ts";

function duration({ startedAt, finishedAt }: InboxEvent): string {
  if (startedAt === null) return "-";
  return `${(((finishedAt ?? Date.now()) - startedAt) / 1000).toFixed(1)}s`;
}

function outcome({ result, error }: InboxEvent): string {
  return (error ?? result ?? "").split("\n")[0];
}

await runCommand(async () => {
  const { events, timers, shortTerm } = await request({ type: "status" });
  console.log("daemon: running");
  for (const timer of timers) {
    console.log(`${timer.kind} ${timer.name}  next ${new Date(timer.dueAt).toLocaleString()}`);
  }
  console.log(`short-term memory: ${shortTerm.length} closed sessions waiting for dream`);
  for (const session of shortTerm) {
    console.log(`closed ${new Date(session.closedAt).toLocaleString()}  ${session.topic}`);
  }
  for (const event of events) {
    console.log(
      [`#${event.id}`, event.type, event.status, event.topic ?? "-", duration(event), outcome(event)].join("  ").trimEnd(),
    );
  }
});
