import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TomlDate } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";
import { root } from "./paths.ts";

export type ScheduleSpec = { daily_at: string } | { every_minutes: number };
export type Schedule = { name: string; prompt: string; model: string; backup_memory: boolean; spec: ScheduleSpec };

export type Config = {
  chat: { model: string };
  router: { model: string };
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

function schedule(table: TomlTable, index: number): Schedule {
  const name = text({ label: `schedule ${index + 1}`, table }, "name");
  const from = { label: `schedule "${name}"`, table };
  const prompt = text(from, "prompt");
  if (!existsSync(join(root, prompt))) throw new Error(`${from.label}: the prompt file ${prompt} does not exist`);
  if ("daily_at" in table === "every_minutes" in table) {
    throw new Error(`${from.label} needs exactly one of daily_at or every_minutes`);
  }
  const backupMemory = table.backup_memory ?? false;
  if (typeof backupMemory !== "boolean") throw new Error(`${from.label}.backup_memory must be a boolean`);
  return {
    name,
    prompt,
    model: "model" in table ? text(from, "model") : "",
    backup_memory: backupMemory,
    spec:
      "daily_at" in table
        ? { daily_at: timeOfDay(from, "daily_at") }
        : { every_minutes: positiveNumber(from, "every_minutes") },
  };
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
    return {
      chat: { model: text(section(data, "chat"), "model") },
      router: { model: text(section(data, "router"), "model") },
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
