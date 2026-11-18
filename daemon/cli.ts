import { runCommand } from "./client.ts";

const usage = `Usage:
  mei chat [--debug] "<prompt>"
  mei status
  mei reload
  mei reset --yes
  mei job <schedule name>
  mei dream
  mei listen [--after <event number>]
  mei schedule list|add|remove|enable|disable ...
  mei background add|list|cancel ...
  mei config [get <key> | set <key> <value>]
  mei update

Connects to the running mei daemon; mei config and mei update also work while it is stopped.`;

const modules: Record<string, string> = { config: "configure" };

await runCommand(async () => {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
  if (!["chat", "status", "reload", "reset", "job", "dream", "listen", "schedule", "background", "config", "update"].includes(command)) {
    throw new Error(`Unknown command "${command}"\n\n${usage}`);
  }
  if ((command === "status" || command === "dream") && process.argv.length > 3) throw new Error(`Usage: mei ${command}`);
  process.argv.splice(2, 1);
  await import(`./${modules[command] ?? command}.ts`);
});
