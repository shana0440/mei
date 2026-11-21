import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { home, logsDir } from "./paths.ts";

export type ScriptOptions = { command: string; timeoutMinutes: number; env: Record<string, string>; logFile: string };

export async function runScript({ command, timeoutMinutes, env, logFile }: ScriptOptions): Promise<string> {
  const child = spawn("sh", ["-c", command], {
    cwd: home,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  let timedOut = false;
  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, timeoutMinutes * 60_000);
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(timeout);
  killGroup();
  appendFileSync(logFile, `${JSON.stringify({ type: "mei_command", command, code, signal, stdout, stderr })}\n`);

  if (timedOut) throw new Error(`${command} ran longer than ${timeoutMinutes} minutes and was stopped`);
  if (code !== 0) throw new Error([`${command} exited with ${signal ?? `status ${code}`}`, stderr.trim()].join("\n").trim());
  return stdout.trim();
}

export const maxScriptAttempts = 3;

export type ScriptTask = { command: string; folder: string; sessionId: string; attempt: number };
export type ScriptFiles = { output: string; status: string; pid: string };

const pollMs = 2000;
const stopGraceMs = 5000;
const outputTail = 4000;
const recordStatus = 'sh -c "$1"; echo $? > "$2"';

export function scriptFiles(eventId: number): ScriptFiles {
  const base = join(logsDir, String(eventId));
  return { output: `${base}.output`, status: `${base}.status`, pid: `${base}.pid` };
}

function startScript({ command, folder }: ScriptTask, files: ScriptFiles): number {
  const outsideTheService = process.env.INVOCATION_ID ? ["systemd-run", "--user", "--scope", "--quiet", "--collect"] : [];
  const [program, ...args] = [...outsideTheService, "sh", "-c", recordStatus, "mei-script", command, files.status];
  const output = openSync(files.output, "a");
  const child = spawn(program, args, { cwd: folder, detached: true, stdio: ["ignore", output, output] });
  closeSync(output);
  child.on("error", () => {});
  child.unref();
  if (child.pid === undefined) throw new Error(`${program} did not start`);
  writeFileSync(files.pid, String(child.pid));
  return child.pid;
}

function isRunning(pid: number, files: ScriptFiles): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(files.status);
  } catch {
    return false;
  }
}

function stopGroup(pid: number): void {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {}
  };
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), stopGraceMs).unref();
}

export async function watchScript(task: ScriptTask, files: ScriptFiles, signal: AbortSignal): Promise<number | null> {
  const pid = existsSync(files.pid) ? Number(readFileSync(files.pid, "utf8")) : startScript(task, files);
  while (!existsSync(files.status) && isRunning(pid, files)) {
    await sleep(pollMs, undefined, { signal }).catch(() => {});
    if (signal.aborted) {
      stopGroup(pid);
      throw new Error("Cancelled");
    }
  }
  return existsSync(files.status) ? Number(readFileSync(files.status, "utf8")) : null;
}

export function lastOutput(path: string, length = outputTail): string {
  if (!existsSync(path)) return "";
  const file = openSync(path, "r");
  const size = fstatSync(file).size;
  const buffer = Buffer.alloc(Math.min(size, length));
  readSync(file, buffer, 0, buffer.length, size - buffer.length);
  closeSync(file);
  return buffer.toString("utf8").trim();
}

export function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function describeEnd(status: number | null, ranFor: number, files: ScriptFiles): string {
  const how =
    status === null
      ? `It stopped after ${elapsed(ranFor)} without an exit status, so something killed it, such as a reboot.`
      : `It exited with status ${status} after ${elapsed(ranFor)}.`;
  const output = lastOutput(files.output);
  const printed = output
    ? `Its full output is in ${files.output}. The end of it:\n\n\`\`\`\n${output}\n\`\`\``
    : "It printed nothing.";
  return `${how} ${printed}`;
}
