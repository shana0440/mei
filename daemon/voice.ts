import { appendFileSync, readFileSync } from "node:fs";
import { recentlySaid } from "./inbox.ts";
import { characterPath } from "./paths.ts";
import type { Deps } from "./worker.ts";

const recentLimit = 4;

type Voicing = { logFile: string; answer: string } & (
  | { message: string }
  | { schedule: string }
);

function task(voicing: Voicing): string {
  if ("message" in voicing) return "Another agent wrote this answer to the user's message.";
  return [
    "A scheduled job finished, and this is its result for the user; the user did not just ask for it.",
    "If the recent conversation is still going on, present the result as a brief aside and do not mix it into that conversation.",
  ].join(" ");
}

export async function voice({ db, config, run }: Deps, voicing: Voicing): Promise<string> {
  const { logFile, answer, ...about } = voicing;
  if (!config.character.enabled) return answer;
  const data = { recent: recentlySaid(db, recentLimit, Date.now()), ...about, answer };
  const { ok, response, error } = await run({
    prompt: `${task(voicing)} "recent" is what you last said to the user, oldest first, across topics. Rewrite the answer as your character and reply with it only.\n\n${JSON.stringify(data, null, 2)}`,
    model: config.character.model,
    tools: false,
    contextFiles: false,
    appendSystemPrompt: readFileSync(characterPath, "utf8"),
  });
  const voiced = ok && response.trim() ? response : answer;
  appendFileSync(logFile, `${JSON.stringify({ type: "mei_voice", original: answer, voiced, error })}\n`);
  return voiced;
}
