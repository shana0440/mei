import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");

export const stateDir = resolve(process.env.MEI_STATE_DIR ?? join(root, "state"));
export const dbPath = join(stateDir, "mei.db");
export const socketPath = join(stateDir, "mei.sock");
