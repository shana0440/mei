import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { memoryDir } from "./paths.ts";

const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: memoryDir });

export async function commitMemory(message: string): Promise<void> {
  try {
    mkdirSync(memoryDir, { recursive: true });
    await git("init", "--quiet");
    await git("add", "--all");
    if ((await git("status", "--porcelain")).stdout === "") return;
    await git("-c", "user.name=mei", "-c", "user.email=mei@localhost", "commit", "--quiet", "--message", message);
  } catch (error) {
    throw new Error(`Could not back up memory/ with git: ${(error as Error).message.trim()}`);
  }
}
