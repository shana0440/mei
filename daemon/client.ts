import { connect } from "node:net";
import { socketPath } from "./paths.ts";
import type { Message, Reply, RequestType } from "./protocol.ts";

export function stream<T extends RequestType>(message: Message<T>, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = connect(socketPath);
    let received = "";
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify(message)}\n`));
    connection.on("error", (error: NodeJS.ErrnoException) => {
      const notRunning = error.code === "ENOENT" || error.code === "ECONNREFUSED";
      reject(notRunning ? new Error("The mei daemon is not running. Start it with: npm run daemon") : error);
    });
    connection.on("data", (chunk: string) => {
      const lines = (received + chunk).split("\n");
      received = lines.pop() ?? "";
      lines.forEach(onLine);
    });
    connection.on("end", resolve);
  });
}

export async function request<T extends RequestType>(
  message: Message<T>,
  onLine: (line: unknown) => void = () => {},
): Promise<Reply<T>> {
  let last: string | undefined;
  await stream(message, (line) => {
    if (last !== undefined) onLine(JSON.parse(last));
    last = line;
  });
  if (last === undefined) throw new Error("The mei daemon stopped before replying");
  const reply: Reply<T> & { error?: string } = JSON.parse(last);
  if (reply.error) throw new Error(reply.error);
  return reply;
}

export async function runCommand(command: () => Promise<void>): Promise<void> {
  try {
    await command();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
