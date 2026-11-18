import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";
import type { TomlTable } from "smol-toml";
import { z } from "zod";
import { home } from "./paths.ts";

const defaultTimeoutMinutes = 10;
const defaultBackgroundTimeoutMinutes = 30;

const text = z.string({ error: "must be a string" });
const flag = z.boolean({ error: "must be true or false" });
const positiveNumber = z.number({ error: "must be a number above 0" }).gt(0, { error: "must be a number above 0" });
const timeOfDay = text.regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "must be a time written as HH:MM" });

function table<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape, {
    error: ({ input }) => (input === undefined ? "is missing" : "must be written as a table"),
  });
}

const role = table({ model: text.default(""), use: text });

const scheduleTable = table({
  name: text,
  daily_at: timeOfDay.optional(),
  every_minutes: positiveNumber.optional(),
  prompt: text.optional(),
  role: text.optional(),
  model: text.optional(),
  command: text.optional(),
  timeout_minutes: positiveNumber.optional(),
  notify: flag.default(true),
  enabled: flag.default(true),
});

type ScheduleTable = z.output<typeof scheduleTable>;
type Fail = (message: string) => never;

function spec({ daily_at, every_minutes }: ScheduleTable, fail: Fail) {
  if (daily_at !== undefined && every_minutes === undefined) return { daily_at };
  if (every_minutes !== undefined && daily_at === undefined) return { every_minutes };
  return fail("needs exactly one of daily_at or every_minutes");
}

function commandPart({ command, timeout_minutes }: ScheduleTable, fail: Fail) {
  if (command !== undefined) return { command, timeoutMinutes: timeout_minutes ?? defaultTimeoutMinutes };
  if (timeout_minutes !== undefined) fail("timeout_minutes applies only to a command");
  return undefined;
}

function promptPart({ prompt, role, model }: ScheduleTable, models: Map<string, string>, defaultRole: string, fail: Fail) {
  if (prompt === undefined) {
    if (role !== undefined) fail("role applies only to a prompt");
    if (model !== undefined) fail("model applies only to a prompt");
    return undefined;
  }
  if (!existsSync(join(home, prompt))) fail(`the prompt file ${prompt} does not exist`);
  if (role !== undefined && model !== undefined) fail("needs at most one of role or model");
  if (model !== undefined) return { prompt, model };
  const roleName = role ?? defaultRole;
  const roleModel = models.get(roleName);
  if (roleModel === undefined) return fail(`role "${roleName}" is not defined under [roles]`);
  return { prompt, model: roleModel };
}

function scheduledJob(schedule: ScheduleTable, models: Map<string, string>, defaultRole: string, fail: Fail) {
  const { name, notify } = schedule;
  const command = commandPart(schedule, fail);
  const prompt = promptPart(schedule, models, defaultRole, fail);
  if (command && prompt) return { name, notify, ...command, ...prompt };
  if (command) return { name, notify, ...command };
  if (prompt) return { name, notify, ...prompt };
  return fail("needs a prompt, a command or both");
}

const configTables = table({
  roles: z.record(z.string(), role, { error: "must be written as [roles.<name>]" }),
  router: table({ model: text, default_role: text }),
  character: table({ name: text, file: text.default("CHARACTER.md"), enabled: flag, model: text }),
  idle: table({ after_minutes: positiveNumber, model: text }),
  dream: table({ daily_at: timeOfDay, model: text }),
  background: table({ timeout_minutes: positiveNumber.default(defaultBackgroundTimeoutMinutes) }).default({
    timeout_minutes: defaultBackgroundTimeoutMinutes,
  }),
  schedule: z.array(scheduleTable, { error: "must be written as [[schedule]]" }).default([]),
});

class BrokenRule extends Error {}

function settings(
  { roles, router, character, idle, dream, background, schedule }: z.output<typeof configTables>,
  fail: (path: PropertyKey[]) => Fail,
) {
  const models = new Map(Object.entries(roles).map(([name, { model }]) => [name, model]));
  if (models.size === 0) fail(["roles"])("define at least one role as [roles.<name>] with model and use");
  if (!models.has(router.default_role)) {
    fail(["router"])(`default_role "${router.default_role}" is not defined under [roles]`);
  }
  const characterFile = resolve(home, character.file);
  if (!existsSync(characterFile)) fail(["character"])(`the character file ${character.file} does not exist`);
  const schedules = schedule.map((table, index) => ({
    ...scheduledJob(table, models, router.default_role, fail(["schedule", index])),
    spec: spec(table, fail(["schedule", index])),
    enabled: table.enabled,
  }));
  schedules.forEach(({ name }, index) => {
    if (schedules.findIndex((other) => other.name === name) < index) {
      fail(["schedule", index])("another schedule has the same name");
    }
  });
  return {
    roles: Object.entries(roles).map(([name, { model, use }]) => ({ name, model, use })),
    router: { model: router.model, defaultRole: router.default_role },
    character: { ...character, file: characterFile },
    idle: { afterMinutes: idle.after_minutes, model: idle.model },
    dream: { spec: { daily_at: dream.daily_at }, model: dream.model },
    background: { timeoutMinutes: background.timeout_minutes },
    schedules,
  };
}

const configFile = configTables.transform((tables, ctx) => {
  const fail = (path: PropertyKey[]) => (message: string): never => {
    ctx.addIssue({ code: "custom", path, message });
    throw new BrokenRule();
  };
  try {
    return settings(tables, fail);
  } catch (error) {
    if (error instanceof BrokenRule) return z.NEVER;
    throw error;
  }
});

export type Config = z.output<typeof configFile>;
export type Role = Config["roles"][number];
export type Schedule = Config["schedules"][number];
export type ScheduleSpec = Schedule["spec"];
export type ScheduledJob = ReturnType<typeof scheduledJob>;

function place(path: PropertyKey[], data: TomlTable): string {
  const [section, entry] = path;
  if (section === "schedule" && typeof entry === "number") {
    const tables = data.schedule as TomlTable[];
    const name = tables[entry]?.name;
    return typeof name === "string" ? `schedule "${name}"` : `schedule ${entry + 1}`;
  }
  return path.map(String).join(".");
}

function describe(issue: z.core.$ZodIssue, data: TomlTable): string {
  const tableDepth = issue.path[0] === "schedule" || issue.path[0] === "roles" ? 2 : 1;
  const tablePath = issue.path.slice(0, tableDepth);
  const key = issue.path.slice(tableDepth).map(String).join(".");
  if (issue.code === "unrecognized_keys") return within(tablePath, `unknown key ${issue.keys.join(", ")}`, data);
  if (issue.code === "custom") return within(tablePath, issue.message, data);
  if (key === "") return `${place(tablePath, data)} ${issue.message}`;
  return within(tablePath, `${key} ${issue.message}`, data);
}

function within(tablePath: PropertyKey[], message: string, data: TomlTable): string {
  return tablePath.length === 0 ? message : `${place(tablePath, data)}: ${message}`;
}

export function loadConfig(path: string): Config {
  return parseConfig(readFileSync(path, "utf8"), path);
}

export function parseConfig(text: string, path: string): Config {
  let data: TomlTable;
  try {
    data = parse(text);
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  const result = configFile.safeParse(data);
  if (result.success) return result.data;
  throw new Error(result.error.issues.map((issue) => `${path}: ${describe(issue, data)}`).join("\n"));
}
