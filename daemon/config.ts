import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TomlDate } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";
import { home } from "./paths.ts";

export type ScheduleSpec = { daily_at: string } | { every_minutes: number };
type Command = { command: string; timeoutMinutes: number };
type Prompt = { prompt: string; model: string };
export type Job = Command | Prompt | (Command & Prompt);
export type ScheduledJob = { name: string; notify: boolean } & Job;
export type Schedule = ScheduledJob & { spec: ScheduleSpec };

const defaultTimeoutMinutes = 10;

export type Role = { name: string; model: string; use: string };

export type Config = {
  roles: Role[];
  router: { model: string; defaultRole: string };
  character: { enabled: boolean; model: string };
  idle: { afterMinutes: number; model: string };
  schedules: Schedule[];
};

type Section = { label: string; table: TomlTable };

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof TomlDate);
}

function section(data: TomlTable, label: string): Section {
  const table = data[label];
  return { label, table: isTable(table) ? table : {} };
}

function text({ label, table }: Section, key: string): string {
  const value = table[key];
  if (typeof value !== "string") throw new Error(`${label}.${key} must be a string`);
  return value;
}

function flag({ label, table }: Section, key: string): boolean {
  const value = table[key];
  if (typeof value !== "boolean") throw new Error(`${label}.${key} must be true or false`);
  return value;
}

function positiveNumber({ label, table }: Section, key: string): number {
  const value = table[key];
  if (typeof value !== "number" || value <= 0) throw new Error(`${label}.${key} must be a number above 0`);
  return value;
}

function timeOfDay(from: Section, key: string): string {
  const value = text(from, key);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${from.label}.${key} must be a time written as HH:MM`);
  return value;
}

function commandPart(from: Section): Command | undefined {
  const { label, table } = from;
  if (!("command" in table)) {
    if ("timeout_minutes" in table) throw new Error(`${label}: timeout_minutes applies only to a command`);
    return undefined;
  }
  return {
    command: text(from, "command"),
    timeoutMinutes: "timeout_minutes" in table ? positiveNumber(from, "timeout_minutes") : defaultTimeoutMinutes,
  };
}

function promptPart(from: Section): Prompt | undefined {
  const { label, table } = from;
  if (!("prompt" in table)) {
    if ("model" in table) throw new Error(`${label}: model applies only to a prompt`);
    return undefined;
  }
  const prompt = text(from, "prompt");
  if (!existsSync(join(home, prompt))) throw new Error(`${label}: the prompt file ${prompt} does not exist`);
  return { prompt, model: "model" in table ? text(from, "model") : "" };
}

function job(from: Section): Job {
  const command = commandPart(from);
  const prompt = promptPart(from);
  if (command && prompt) return { ...command, ...prompt };
  const only = command ?? prompt;
  if (!only) throw new Error(`${from.label} needs a prompt, a command or both`);
  return only;
}

function schedule(table: TomlTable, index: number): Schedule {
  const name = text({ label: `schedule ${index + 1}`, table }, "name");
  const from = { label: `schedule "${name}"`, table };
  if ("daily_at" in table === "every_minutes" in table) {
    throw new Error(`${from.label} needs exactly one of daily_at or every_minutes`);
  }
  return {
    name,
    ...job(from),
    notify: "notify" in table ? flag(from, "notify") : true,
    spec:
      "daily_at" in table
        ? { daily_at: timeOfDay(from, "daily_at") }
        : { every_minutes: positiveNumber(from, "every_minutes") },
  };
}

function roles(data: TomlTable): Role[] {
  const { table } = section(data, "roles");
  const list = Object.entries(table).map(([name, role]) => {
    if (!isTable(role)) throw new Error(`roles.${name} must be written as [roles.${name}]`);
    const from = { label: `roles.${name}`, table: role };
    return { name, model: text(from, "model"), use: text(from, "use") };
  });
  if (list.length === 0) throw new Error("define at least one role as [roles.<name>] with model and use");
  return list;
}

function schedules(data: TomlTable): Schedule[] {
  const tables = data.schedule ?? [];
  if (!Array.isArray(tables) || !tables.every(isTable)) throw new Error("schedule must be written as [[schedule]]");
  const list = tables.map(schedule);
  const repeated = list.find(({ name }, index) => list.findIndex((other) => other.name === name) < index);
  if (repeated) throw new Error(`Two schedules are named "${repeated.name}"`);
  return list;
}

export function loadConfig(path: string): Config {
  try {
    const data = parse(readFileSync(path, "utf8"));
    const router = section(data, "router");
    const defaultRole = text(router, "default_role");
    const roleList = roles(data);
    if (!roleList.some(({ name }) => name === defaultRole)) {
      throw new Error(`router.default_role "${defaultRole}" is not defined under [roles]`);
    }
    return {
      roles: roleList,
      router: { model: text(router, "model"), defaultRole },
      character: {
        enabled: flag(section(data, "character"), "enabled"),
        model: text(section(data, "character"), "model"),
      },
      idle: {
        afterMinutes: positiveNumber(section(data, "idle"), "after_minutes"),
        model: text(section(data, "idle"), "model"),
      },
      schedules: schedules(data),
    };
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}
