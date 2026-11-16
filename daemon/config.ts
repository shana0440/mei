import { readFileSync } from "node:fs";
import { parse, TomlDate } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";

export type Config = {
  chat: { model: string };
  router: { model: string };
  idle: { afterMinutes: number };
};

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof TomlDate);
}

function setting(data: TomlTable, section: string, key: string): TomlValue | undefined {
  const table = data[section];
  return isTable(table) ? table[key] : undefined;
}

function text(data: TomlTable, section: string, key: string): string {
  const value = setting(data, section, key);
  if (typeof value !== "string") throw new Error(`${section}.${key} must be a string`);
  return value;
}

function positiveNumber(data: TomlTable, section: string, key: string): number {
  const value = setting(data, section, key);
  if (typeof value !== "number" || value <= 0) throw new Error(`${section}.${key} must be a number above 0`);
  return value;
}

export function loadConfig(path: string): Config {
  try {
    const data = parse(readFileSync(path, "utf8"));
    return {
      chat: { model: text(data, "chat", "model") },
      router: { model: text(data, "router", "model") },
      idle: { afterMinutes: positiveNumber(data, "idle", "after_minutes") },
    };
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}
