import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { home } from "./paths.ts";

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
  const [code, signal]: [number | null, NodeJS.Signals | null] = await once(child, "close");
  clearTimeout(timeout);
  killGroup();
  appendFileSync(logFile, `${JSON.stringify({ type: "mei_command", command, code, signal, stdout, stderr })}\n`);

  if (timedOut) throw new Error(`${command} ran longer than ${timeoutMinutes} minutes and was stopped`);
  if (code !== 0) throw new Error([`${command} exited with ${signal ?? `status ${code}`}`, stderr.trim()].join("\n").trim());
  return stdout.trim();
}
