import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const { eventId } = await request({ type: "dream" });
  console.log(`Queued as #${eventId}; see: npm run status`);
});
