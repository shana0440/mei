import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { payload: { type: "string", default: "{}" }, dedupe: { type: "string" } },
  });
  if (positionals.length !== 1) {
    throw new Error("Usage: npm run event -- <type> [--payload '<json>'] [--dedupe <key>]");
  }
  const event = { type: positionals[0], payload: JSON.parse(values.payload), dedupeKey: values.dedupe };
  const { id } = await request({ type: "event.add", event });
  console.log(id);
});
