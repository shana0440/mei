import { parseArgs } from "node:util";
import { runCommand, stream } from "./client.ts";

await runCommand(async () => {
  const { values } = parseArgs({ options: { after: { type: "string" } } });
  const after = values.after === undefined ? undefined : Number(values.after);
  if (after !== undefined && !Number.isInteger(after)) throw new Error("Usage: npm run listen -- [--after <event number>]");
  await stream({ type: "listen", after }, (line) => console.log(line));
});
