import { join, resolve } from "node:path";

export const root = join(import.meta.dirname, "..");

const stateDir = resolve(process.env.MEI_STATE_DIR ?? join(root, "state"));
export const dbPath = join(stateDir, "mei.db");
export const socketPath = join(stateDir, "mei.sock");
export const logsDir = join(stateDir, "logs");
export const chatSessionsDir = join(stateDir, "sessions", "chat");
export const configPath = join(root, "config.toml");
export const routePromptPath = join(root, "prompts", "route.md");
export const summarizePromptPath = join(root, "prompts", "summarize.md");
