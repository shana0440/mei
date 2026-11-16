import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { root } from "./paths.ts";

export type RunOptions = {
  prompt: string;
  sessionId?: string;
  sessionDir?: string;
  model?: string;
  tools?: boolean;
  contextFiles?: boolean;
  logFile?: string;
  cwd?: string;
};

export type RunResult = { ok: boolean; response: string; error: string; sessionId: string };

function sessionManager(cwd: string, { sessionId, sessionDir }: RunOptions): SessionManager {
  if (!sessionId && !sessionDir) return SessionManager.inMemory(cwd);
  const existing = sessionId && SessionManager.findById(cwd, sessionId, sessionDir);
  return existing
    ? SessionManager.open(existing, sessionDir)
    : SessionManager.create(cwd, sessionDir, { id: sessionId });
}

function findModel(modelRuntime: ModelRuntime, name: string) {
  const [provider, ...id] = name.split("/");
  const model = modelRuntime.getModel(provider, id.join("/"));
  if (!model) throw new Error(`Unknown model "${name}"`);
  return model;
}

async function openSession(options: RunOptions): Promise<AgentSession> {
  const cwd = options.cwd ?? root;
  const modelRuntime = await ModelRuntime.create();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noContextFiles: options.contextFiles === false,
    extensionFactories: [createCodemodeExtension(), createToolSearchExtension(), createMcpExtension()],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    modelRuntime,
    resourceLoader,
    model: options.model ? findModel(modelRuntime, options.model) : undefined,
    noTools: options.tools === false ? "all" : undefined,
    sessionManager: sessionManager(cwd, options),
  });
  await session.bindExtensions({});
  return session;
}

function failure(session: AgentSession): string {
  const last = session.messages.findLast((message) => message.role === "assistant");
  if (last?.stopReason !== "error" && last?.stopReason !== "aborted") return "";
  return `the last assistant message stopped with ${last.stopReason}: ${last.errorMessage ?? "no message"}`;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { logFile } = options;
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  try {
    const session = await openSession(options);
    try {
      session.subscribe((event) => {
        if (logFile && event.type !== "message_update") appendFileSync(logFile, `${JSON.stringify(event)}\n`);
      });
      await session.prompt(options.prompt);
      const error = failure(session);
      return { ok: !error, response: session.getLastAssistantText() ?? "", error, sessionId: session.sessionId };
    } finally {
      session.dispose();
    }
  } catch (error) {
    return { ok: false, response: "", error: (error as Error).message, sessionId: options.sessionId ?? "" };
  }
}
