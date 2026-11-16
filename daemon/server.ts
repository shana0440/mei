import { rmSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import type { Message, Reply, RequestType } from "./protocol.ts";

export type Send = (line: unknown) => void;
export type Handlers = {
  [T in RequestType]: (message: Message<T>, send: Send) => Reply<T> | Promise<Reply<T>>;
};
type Handler = (message: unknown, send: Send) => unknown;

async function reply(handlers: Handlers, requestLine: string, send: Send): Promise<unknown> {
  try {
    const message: { type: string } = JSON.parse(requestLine);
    const handler = (handlers as Record<string, Handler | undefined>)[message.type];
    if (!handler) throw new Error(`Unknown request type "${message.type}"`);
    return await handler(message, send);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export function startServer(socketPath: string, handlers: Handlers): Promise<Server> {
  rmSync(socketPath, { force: true });
  const server = createServer((connection) => {
    const send: Send = (line) => connection.write(`${JSON.stringify(line)}\n`);
    let received = "";
    connection.setEncoding("utf8");
    connection.on("error", () => {});
    connection.on("data", async function receive(chunk: string) {
      received += chunk;
      const end = received.indexOf("\n");
      if (end < 0) return;
      connection.off("data", receive);
      connection.end(`${JSON.stringify(await reply(handlers, received.slice(0, end), send))}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}
