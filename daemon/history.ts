import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  if (process.argv.length > 3) throw new Error("Usage: mei history [session-id]");
  const { messages } = await request({ type: "history", sessionId: process.argv[2] });
  for (const message of messages) console.log(JSON.stringify(message));
});
