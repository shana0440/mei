import { runCommand } from "./client.ts";

const usage = `Usage:
  mei chat [--debug] "<prompt>"
  mei status
  mei reload
  mei reset --yes
  mei job <schedule name>
  mei listen [--after <event number>]
  mei schedule list|add|remove|enable|disable ...

Connects to the running mei daemon.`;

await runCommand(async () => {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
  if (!["chat", "status", "reload", "reset", "job", "listen", "schedule"].includes(command)) {
    throw new Error(`Unknown command "${command}"\n\n${usage}`);
  }
  if (command === "status" && process.argv.length > 3) throw new Error("Usage: mei status");
  process.argv.splice(2, 1);
  await import(`./${command}.ts`);
});
