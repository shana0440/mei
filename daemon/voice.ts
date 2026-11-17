import { appendFileSync, readFileSync } from "node:fs";
import { characterPath } from "./paths.ts";
import { recentExchanges } from "./sessions.ts";
import type { Deps } from "./worker.ts";

const recentLimit = 2;

type Voicing = { message: string; answer: string; sessionId: string; logFile: string };

export async function voice({ db, config, run }: Deps, { message, answer, sessionId, logFile }: Voicing): Promise<string> {
  if (!config.character.enabled) return answer;
  const data = { recent: recentExchanges(db, sessionId, recentLimit), message, answer };
  const { ok, response, error } = await run({
    prompt: `Another agent wrote this answer to the user's message. Rewrite the answer as your character and reply with it only.\n\n${JSON.stringify(data, null, 2)}`,
    model: config.character.model,
    tools: false,
    contextFiles: false,
    appendSystemPrompt: readFileSync(characterPath, "utf8"),
  });
  const voiced = ok && response.trim() ? response : answer;
  appendFileSync(logFile, `${JSON.stringify({ type: "mei_voice", original: answer, voiced, error })}\n`);
  return voiced;
}
