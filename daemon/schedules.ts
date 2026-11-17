import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "smol-toml";
import { parseConfig } from "./config.ts";
import type { Config, Schedule } from "./config.ts";
import { configPath } from "./paths.ts";

export type ScheduleChange = { action: "remove" | "enable" | "disable"; name: string };

const tableHeader = /^\[\[?[\w.\-"]+\]\]?\s*(#.*)?$/;
const keyLine = /^\s*[\w-]+\s*=/;

type Block = { start: number; end: number };

function scheduleBlock(lines: string[], name: string): Block {
  const headers = lines.flatMap((line, index) => (tableHeader.test(line) ? [index] : []));
  for (const [position, start] of headers.entries()) {
    if (!/^\[\[schedule\]\]/.test(lines[start])) continue;
    const segment = lines.slice(start, headers[position + 1] ?? lines.length);
    const { schedule } = parse(segment.join("\n")) as { schedule: { name?: unknown }[] };
    if (schedule[0].name !== name) continue;
    const lastKey = segment.findLastIndex((line) => keyLine.test(line));
    return { start, end: start + lastKey + 1 };
  }
  throw new Error(`config.toml has no [[schedule]] block named "${name}"; edit it by hand`);
}

function withScheduleRemoved(text: string, name: string): string {
  const lines = text.split("\n");
  const { start, end } = scheduleBlock(lines, name);
  const blankAfter = lines[end]?.trim() === "" && end < lines.length - 1 ? 1 : 0;
  lines.splice(start, end - start + blankAfter);
  return lines.join("\n");
}

function withScheduleEnabled(text: string, name: string, enabled: boolean): string {
  const lines = text.split("\n");
  const { start, end } = scheduleBlock(lines, name);
  const block = lines.slice(start, end).filter((line) => !/^\s*enabled\s*=/.test(line));
  if (!enabled) block.push("enabled = false");
  lines.splice(start, end - start, ...block);
  return lines.join("\n");
}

function withoutSchedule(config: Config, name: string): string {
  return JSON.stringify({ ...config, schedules: config.schedules.filter((schedule) => schedule.name !== name) });
}

function edit(text: string, change: ScheduleChange): { text: string; expected: (schedule?: Schedule) => boolean } {
  switch (change.action) {
    case "remove":
      return { text: withScheduleRemoved(text, change.name), expected: (schedule) => schedule === undefined };
    case "enable":
    case "disable": {
      const enabled = change.action === "enable";
      return { text: withScheduleEnabled(text, change.name, enabled), expected: (schedule) => schedule?.enabled === enabled };
    }
  }
}

export function changeSchedules(change: ScheduleChange): Config {
  const text = readFileSync(configPath, "utf8");
  const before = parseConfig(text, configPath);
  const { name } = change;
  if (!before.schedules.some((schedule) => schedule.name === name)) throw new Error(`No schedule is named "${name}"`);
  const edited = edit(text, change);
  const after = parseConfig(edited.text, configPath);
  const changed = after.schedules.find((schedule) => schedule.name === name);
  if (withoutSchedule(before, name) !== withoutSchedule(after, name) || !edited.expected(changed)) {
    throw new Error(`Could not change schedule "${name}" in config.toml safely; edit it by hand`);
  }
  writeFileSync(configPath, edited.text);
  return after;
}
