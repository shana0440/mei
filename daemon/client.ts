import { connect } from "node:net";
import { socketPath } from "./paths.ts";
import type { Message, Reply, RequestType } from "./protocol.ts";

export function request<T extends RequestType>(
  message: Message<T>,
  onLine: (line: unknown) => void = () => {},
): Promise<Reply<T>> {
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
      received += chunk;
      const lines = received.split("\n");
      received = lines.slice(-2).join("\n");
      lines.slice(0, -2).forEach((line) => onLine(JSON.parse(line)));
    });
    connection.on("end", () => {
      const reply: Reply<T> & { error?: string } = JSON.parse(received);
      if (reply.error) reject(new Error(reply.error));
      else resolve(reply);
    });
  });
}

export async function runCommand(command: () => Promise<void>): Promise<void> {
  try {
    await command();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
