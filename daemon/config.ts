import { readFileSync } from "node:fs";
import { parse, TomlDate } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";

export type Config = { chat: { model: string } };

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof TomlDate);
}

function text(data: TomlTable, section: string, key: string): string {
  const table = data[section];
  const value = isTable(table) ? table[key] : undefined;
  if (typeof value !== "string") throw new Error(`${section}.${key} must be a string`);
  return value;
}

export function loadConfig(path: string): Config {
  try {
    const data = parse(readFileSync(path, "utf8"));
    return { chat: { model: text(data, "chat", "model") } };
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}
