import { request, runCommand } from "./client.ts";
import type { ScheduleListing } from "./protocol.ts";

const usage = `Usage:
  mei schedule list
  mei schedule enable <name>
  mei schedule disable <name>`;

function when({ spec }: ScheduleListing): string {
  return spec.daily_at !== undefined ? `daily at ${spec.daily_at}` : `every ${spec.every_minutes} minutes`;
}

function what(schedule: ScheduleListing): string {
  return [
    "command" in schedule ? `command ${schedule.command}` : "",
    "prompt" in schedule ? `prompt ${schedule.prompt}` : "",
  ].filter(Boolean).join(", ");
}

function list(schedules: ScheduleListing[]): void {
  for (const schedule of schedules) {
    const next = schedule.dueAt === null ? "next -" : `next ${new Date(schedule.dueAt).toLocaleString()}`;
    const state = schedule.enabled ? "enabled" : "disabled";
    console.log([schedule.name, state, when(schedule), next, what(schedule)].join("  "));
  }
}

await runCommand(async () => {
  const [action, ...args] = process.argv.slice(2);
  if (action === "list" && args.length === 0) {
    list((await request({ type: "schedules" })).schedules);
    return;
  }
  if ((action === "enable" || action === "disable") && args.length === 1) {
    const [name] = args;
    await request({ type: "schedule", change: { action, name } });
    console.log(`${{ enable: "Enabled", disable: "Disabled" }[action]} schedule "${name}"`);
    return;
  }
  throw new Error(usage);
});
