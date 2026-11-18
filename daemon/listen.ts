import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { runCommand, stream } from "./client.ts";

const retryAfter = 1000;

await runCommand(async () => {
  const { values } = parseArgs({ options: { after: { type: "string" } } });
  let after = values.after === undefined ? undefined : Number(values.after);
  if (after !== undefined && !Number.isInteger(after)) throw new Error("Usage: npm run listen -- [--after <event number>]");
  let waiting = false;
  for (;;) {
    await stream({ type: "listen", after }, (line) => {
      const event: { id?: number; status?: string; error?: string } = JSON.parse(line);
      if (event.id === undefined) {
        console.error(event.error);
        process.exit(1);
      }
      console.log(line);
      if (event.status !== "running") after = event.id;
      waiting = false;
    }).catch(() => {});
    if (!waiting) console.error("Waiting for the mei daemon");
    waiting = true;
    await sleep(retryAfter);
  }
});
