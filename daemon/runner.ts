import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { root } from "./paths.ts";

export type RunOptions = {
  prompt: string;
  sessionId?: string;
  sessionDir?: string;
  model?: string;
  tools?: boolean;
  contextFiles?: boolean;
  appendSystemPrompt?: string;
  logFile?: string;
  onLine?: (line: string) => void;
  cwd?: string;
};

export type RunResult = { ok: boolean; response: string; error: string; sessionId: string };

type AssistantMessage = {
  role: "assistant";
  content: { type: string; text?: string }[];
  stopReason: string;
  errorMessage?: string;
};

type StreamRecord =
  | { type: "session"; id: string }
  | { type: "message_end"; message: AssistantMessage | { role: "system" | "user" | "toolResult" } }
  | { type: "agent_settled"; aborted: boolean };

const stderrTailLength = 2000;

function sessionArgs({ sessionId, sessionDir }: RunOptions): string[] {
  if (!sessionId && !sessionDir) return ["--no-session"];
  return [
    ...(sessionId ? ["--session-id", sessionId] : []),
    ...(sessionDir ? ["--session-dir", sessionDir] : []),
  ];
}

function runArgs(options: RunOptions): string[] {
  return [
    "--mode",
    "json",
    ...sessionArgs(options),
    ...(options.model ? ["--model", options.model] : []),
    ...(options.tools === false ? ["--no-tools"] : []),
    ...(options.contextFiles === false ? ["--no-context-files"] : []),
    ...(options.appendSystemPrompt ? ["--append-system-prompt", options.appendSystemPrompt] : []),
    "--",
    options.prompt,
  ];
}

async function* lines(stream: AsyncIterable<string>): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of stream) {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop() ?? "";
    yield* parts;
  }
  if (rest) yield rest;
}

function responseText(message: AssistantMessage | undefined): string {
  return (message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("");
}

function messageFailure(message: AssistantMessage | undefined): string | undefined {
  if (message?.stopReason !== "error" && message?.stopReason !== "aborted") return undefined;
  return `the last assistant message stopped with ${message.stopReason}: ${message.errorMessage ?? "no message"}`;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { logFile, onLine } = options;
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });

  const child = spawn("pi-bolt", runArgs(options), {
    cwd: options.cwd ?? root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitFailure = new Promise<string | undefined>((resolve) => {
    child.on("error", (error) => resolve(`pi-bolt did not start: ${error.message}`));
    child.on("close", (code, signal) =>
      resolve(code === 0 ? undefined : `pi-bolt exited with ${signal ?? `status ${code}`}`),
    );
  });

  let stderrTail = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-stderrTailLength);
    if (logFile) appendFileSync(`${logFile}.stderr`, chunk);
  });

  let sessionId = options.sessionId ?? "";
  let lastAssistant: AssistantMessage | undefined;
  let aborted: boolean | undefined;

  for await (const line of lines(child.stdout.setEncoding("utf8"))) {
    if (logFile) appendFileSync(logFile, `${line}\n`);
    onLine?.(line);
    const record: StreamRecord = JSON.parse(line);
    if (record.type === "session") sessionId = record.id;
    if (record.type === "message_end" && record.message.role === "assistant" && aborted === undefined) {
      lastAssistant = record.message;
    }
    if (record.type === "agent_settled") aborted ??= record.aborted;
  }

  const failure =
    (await exitFailure) ??
    (aborted === undefined ? "the stream ended without agent_settled" : undefined) ??
    (aborted ? "the run was aborted" : undefined) ??
    messageFailure(lastAssistant);

  return {
    ok: !failure,
    response: responseText(lastAssistant),
    error: failure ? [failure, stderrTail.trim()].filter(Boolean).join("\n") : "",
    sessionId,
  };
}
