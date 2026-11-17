import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");

export const home = resolve(process.env.MEI_HOME ?? join(homedir(), ".local", "share", "mei"));
export const templateDir = join(root, "template");
export const configPath = join(home, "config.toml");
export const projectsPath = join(home, "PROJECTS.md");
export const characterPath = join(home, "CHARACTER.md");
export const routePromptPath = join(root, "prompts", "route.md");
export const summarizePromptPath = join(home, "prompts", "summarize.md");

const stateDir = join(home, "state");
export const dbPath = join(stateDir, "mei.db");
export const socketPath = join(stateDir, "mei.sock");
export const logsDir = join(stateDir, "logs");
export const chatSessionsDir = join(stateDir, "sessions", "chat");
