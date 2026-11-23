import { appendFileSync, readFileSync } from "node:fs";
import { recentlySaid } from "./inbox.ts";
import type { Deps } from "./worker.ts";

const recentLimit = 4;

export type About =
  | { message: string }
  | { schedule: string }
  | { task: string }
  | { script: string }
  | { reminder: true; minutesLate: number };

type Voicing = { logFile: string; answer: string; about: About };

const asAside =
  "If the recent conversation is still going on, present it as a brief aside and do not mix it into that conversation.";

function task(about: About): string {
  if ("message" in about) return "Another agent wrote this answer to the user's message.";
  if ("schedule" in about) {
    return `A scheduled job finished, and this is its result for the user; the user did not just ask for it. ${asAside}`;
  }
  if ("task" in about) {
    return `A background task the user handed you earlier finished, and this is its result; "task" is what it was asked to do. ${asAside}`;
  }
  if ("script" in about) {
    return `A script started earlier for the user ended, and the agent that started it checked how it went; "script" is the command. ${asAside}`;
  }
  return `The user asked you to tell them this at this time. If "minutesLate" is more than a few minutes, say it comes late. ${asAside}`;
}

export async function voice({ db, config, run }: Deps, { logFile, answer, about }: Voicing): Promise<string> {
  if (!config.character.enabled) return answer;
  const data = { recent: recentlySaid(db, recentLimit, Date.now()), ...about, answer };
  const { ok, response, error } = await run({
    prompt: `${task(about)} "recent" is what you last said to the user, oldest first, across topics.\n\n${JSON.stringify(data, null, 2)}`,
    model: config.character.model,
    tools: false,
    contextFiles: false,
    appendSystemPrompt: `Your name is ${config.character.name}.\n\n${readFileSync(config.character.file, "utf8")}`,
  });
  const voiced = ok && response.trim() ? response : answer;
  appendFileSync(logFile, `${JSON.stringify({ type: "mei_voice", original: answer, voiced, error })}\n`);
  return voiced;
}
