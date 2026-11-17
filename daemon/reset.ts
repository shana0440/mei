import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  if (!values.yes) {
    throw new Error("This permanently deletes memory, history, logs and the inbox. Confirm with: mei reset --yes (or npm run reset -- --yes)");
  }
  await request({ type: "reset" });
  console.log("Memory, history, logs and inbox cleared.");
});
