import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const [name] = process.argv.slice(2);
  if (!name) throw new Error("Usage: npm run job -- <schedule name>");
  const { eventId } = await request({ type: "job", name });
  console.log(`Queued as #${eventId}; see: npm run status`);
});
