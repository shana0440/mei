import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";
import { DaemonNotRunning, request, runCommand } from "./client.ts";
import { parseConfig } from "./config.ts";
import { configPath } from "./paths.ts";
import { keyLine, tableHeader } from "./schedules.ts";

const usage = `Usage:
  mei config                          open config.toml in $EDITOR, check it and reload
  mei config get <table>.<key>        e.g. mei config get character.file
  mei config set <table>.<key> <value>`;

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function lookup(data: TomlTable, path: string[]): TomlValue | undefined {
  return path.reduce<TomlValue | undefined>((value, key) => (isTable(value) ? value[key] : undefined), data);
}

function literal(value: TomlValue): string {
  return stringify({ value }).trim().replace(/^value = /, "");
}

function keyPath(key: string): string[] {
  const path = key.split(".");
  if (path.length < 2 || !path.every((part) => /^[\w-]+$/.test(part))) {
    throw new Error(`"${key}" is not a key; write it as <table>.<key>, e.g. character.name`);
  }
  if (path[0] === "schedule") throw new Error("Change schedules with mei schedule, or edit them with mei config");
  return path;
}

async function saved(): Promise<void> {
  try {
    await request({ type: "reload" });
    console.log("Saved and reloaded config.toml");
  } catch (error) {
    if (!(error instanceof DaemonNotRunning)) throw error;
    console.log("Saved config.toml; the daemon is not running, so it applies at the next start");
  }
}

function get(key: string): void {
  const value = lookup(parse(readFileSync(configPath, "utf8")), keyPath(key));
  if (value === undefined) throw new Error(`${key} is not set in config.toml`);
  console.log(typeof value === "string" ? value : isTable(value) ? stringify(value) : literal(value));
}

function valueOf(text: string): TomlValue {
  try {
    return parse(`value = ${text}`).value;
  } catch {
    return text;
  }
}

function headerPath(line: string): string[] | undefined {
  if (!tableHeader.test(line) || line.trimStart().startsWith("[[")) return undefined;
  const path: string[] = [];
  let table: TomlValue = parse(line);
  while (isTable(table) && Object.keys(table).length === 1) {
    const [key] = Object.keys(table);
    path.push(key);
    table = table[key];
  }
  return path;
}

function withComment(assignment: string, line: string): string {
  const rest = line.slice(line.indexOf("=") + 1);
  for (const [index, character] of [...rest].entries()) {
    if (character !== "#") continue;
    try {
      parse(`value = ${rest.slice(0, index)}`);
    } catch {
      continue;
    }
    const commentColumn = line.length - rest.length + index;
    return `${assignment.padEnd(commentColumn - 1)} ${rest.slice(index)}`;
  }
  return assignment;
}

function withValue(text: string, path: string[], value: TomlValue): string {
  const lines = text.split("\n");
  const table = path.slice(0, -1);
  const key = path[path.length - 1];
  const assignment = `${key} = ${literal(value)}`;
  const headers = lines.flatMap((line, index) => (tableHeader.test(line) ? [index] : []));
  const start = headers.find((index) => isDeepStrictEqual(headerPath(lines[index]), table));
  if (start === undefined) return `${text.trimEnd()}\n\n[${table.join(".")}]\n${assignment}\n`;
  const end = headers.find((index) => index > start) ?? lines.length;
  const block = lines.slice(start + 1, end);
  const existing = block.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (existing >= 0) {
    lines[start + 1 + existing] = withComment(assignment, block[existing]);
  } else {
    lines.splice(start + 1 + block.findLastIndex((line) => keyLine.test(line)) + 1, 0, assignment);
  }
  return lines.join("\n");
}

async function set(key: string, text: string): Promise<void> {
  const path = keyPath(key);
  const current = readFileSync(configPath, "utf8");
  const data = parse(current);
  const parents = path.slice(0, -1).map((_, index) => lookup(data, path.slice(0, index + 1)));
  if (!parents.every((parent) => parent === undefined || isTable(parent))) throw new Error(`${key} is not inside a table`);
  if (isTable(lookup(data, path))) throw new Error(`${key} is a table; set one of its keys`);
  const value = valueOf(text);
  const edited = withValue(current, path, value);
  const expected = parse(current);
  const parent = path.slice(0, -1).reduce<TomlTable>((table, part) => (table[part] ??= Object.create(null)) as TomlTable, expected);
  parent[path[path.length - 1]] = value;
  if (!isDeepStrictEqual(parse(edited), expected)) throw new Error(`Could not set ${key} safely; edit it with mei config`);
  parseConfig(edited, configPath);
  writeFileSync(configPath, edited);
  await saved();
}

async function editAgain(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Edit again? [Y/n] ");
  prompt.close();
  return !/^n/i.test(answer.trim());
}

async function edit(): Promise<void> {
  const original = readFileSync(configPath, "utf8");
  const draftDir = mkdtempSync(join(tmpdir(), "mei-config-"));
  const draft = join(draftDir, "config.toml");
  writeFileSync(draft, original);
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  for (;;) {
    const { status } = spawnSync("sh", ["-c", `${editor} "$1"`, "sh", draft], { stdio: "inherit" });
    if (status !== 0) throw new Error(`${editor} exited with status ${status}; config.toml is unchanged, your draft is ${draft}`);
    const text = readFileSync(draft, "utf8");
    if (text === original) {
      rmSync(draftDir, { recursive: true });
      console.log("No changes");
      return;
    }
    try {
      parseConfig(text, configPath);
    } catch (error) {
      console.error((error as Error).message);
      if (await editAgain()) continue;
      rmSync(draftDir, { recursive: true });
      console.log("config.toml is unchanged");
      return;
    }
    if (readFileSync(configPath, "utf8") !== original) {
      throw new Error(`config.toml changed while you were editing; it is unchanged, your draft is ${draft}`);
    }
    writeFileSync(configPath, text);
    rmSync(draftDir, { recursive: true });
    await saved();
    return;
  }
}

await runCommand(async () => {
  const [action, ...args] = process.argv.slice(2);
  if (action === undefined) return edit();
  if (action === "get" && args.length === 1) return get(args[0]);
  if (action === "set" && args.length === 2) return set(args[0], args[1]);
  throw new Error(usage);
});
