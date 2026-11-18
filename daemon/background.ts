import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";
import type { BackgroundTask, InboxEvent } from "./inbox.ts";

const usage = `Usage:
  mei background add [--at <time>] [--say] "<prompt>"
  mei background list
  mei background cancel <number>

--at takes a local time such as 2026-01-31T10:00; --say says the text at that time instead of running it.`;

function at(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const time = new Date(text).getTime();
  if (Number.isNaN(time)) throw new Error(`"${text}" is not a time; write it like 2026-01-31T10:00`);
  return time;
}

function state({ status, runAt, startedAt }: InboxEvent, timeoutMinutes: number): string {
  if (status === "running" && startedAt !== null) {
    const stopsAt = new Date(startedAt + timeoutMinutes * 60_000);
    return `running since ${new Date(startedAt).toLocaleTimeString()}, stops at ${stopsAt.toLocaleTimeString()}`;
  }
  if (status === "running") return "reporting back";
  if (runAt !== null && runAt > Date.now()) return `waiting until ${new Date(runAt).toLocaleString()}`;
  return "queued";
}

function what(event: InboxEvent): string {
  const { text, say } = event.payload as BackgroundTask;
  const line = text.split("\n")[0];
  return `${say ? "say " : ""}${line.length > 80 ? `${line.slice(0, 80)}…` : line}`;
}

await runCommand(async () => {
  const [action, ...args] = process.argv.slice(2);
  if (action === "add") {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { at: { type: "string" }, say: { type: "boolean" } },
    });
    if (positionals.length !== 1) throw new Error(usage);
    const { eventId, listening } = await request({
      type: "task",
      text: positionals[0],
      at: at(values.at),
      say: values.say,
      fromSession: process.env.PI_SESSION_ID,
    });
    console.log(values.at === undefined ? `Queued as #${eventId}` : `Waiting as #${eventId}`);
    if (!listening) console.error("Nothing is listening for results right now; this one is kept until mei listen connects.");
    return;
  }
  if (action === "list" && args.length === 0) {
    const { tasks, timeoutMinutes } = await request({ type: "tasks" });
    if (tasks.length === 0) console.log("No background tasks");
    for (const task of tasks) console.log([`#${task.id}`, state(task, timeoutMinutes), what(task)].join("  "));
    return;
  }
  if (action === "cancel" && args.length === 1 && Number.isInteger(Number(args[0]))) {
    await request({ type: "cancel", eventId: Number(args[0]) });
    console.log(`Cancelled #${args[0]}`);
    return;
  }
  throw new Error(usage);
});
