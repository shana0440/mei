import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 1) throw new Error('Usage: npm run chat -- "<prompt>"');
  const { id } = await request({ type: "chat", text: positionals[0] });
  console.error(`Queued as event #${id}; see: npm run status`);
});
