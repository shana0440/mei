import { request, runCommand } from "./client.ts";

await runCommand(async () => {
  if (process.argv.length > 2) throw new Error("Usage: mei reload");
  await request({ type: "reload" });
  console.log("Configuration reloaded. Instructions and prompts are read on each run.");
});
