import { parseArgs } from "node:util";
import { request, runCommand } from "./client.ts";

type DebugLine =
  | { type: "mei_route"; topic: string; role: string; isNew: boolean; reason: string }
  | { type: "message_update"; assistantMessageEvent: { type: string; delta?: string } }
  | { type: "tool_execution_start"; toolName: string; args: Record<string, unknown> };

function mainArgument(args: Record<string, unknown>): string {
  const value = Object.values(args).find((argument) => typeof argument === "string") ?? "";
  return value.split("\n")[0].slice(0, 100);
}

function render(line: DebugLine): string {
  switch (line.type) {
    case "mei_route":
      return `[route] ${line.isNew ? "new session" : "resume"} "${line.topic}" as ${line.role}: ${line.reason}\n`;
    case "tool_execution_start":
      return `[tool] ${line.toolName} ${mainArgument(line.args)}\n`;
    case "message_update": {
      const { type, delta } = line.assistantMessageEvent;
      if (type === "text_delta" || type === "thinking_delta") return delta ?? "";
      return type === "text_end" || type === "thinking_end" ? "\n" : "";
    }
    default:
      return "";
  }
}

process.on("SIGINT", () => {
  console.error("Still running in the background; see: npm run status");
  process.exit(130);
});

await runCommand(async () => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { debug: { type: "boolean" } } });
  if (positionals.length !== 1) throw new Error('Usage: mei chat [--debug] "<prompt>" (or npm run chat -- [--debug] "<prompt>")');
  const { result, topic } = await request({ type: "chat", text: positionals[0], debug: values.debug }, (line) =>
    process.stderr.write(render(line as DebugLine)),
  );
  console.error(`[${topic}]`);
  console.log(result);
});
