import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 1) throw new Error('Usage: npm run chat -- "<prompt>"');
  const { result } = await request({ type: "chat", text: positionals[0] });
  console.log(result);
});
