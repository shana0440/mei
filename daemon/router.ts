import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { recentSessions } from "./inbox.ts";
import { routePromptPath } from "./paths.ts";
import type { Deps } from "./worker.ts";

export type Route = { sessionId: string; topic: string; isNew: boolean; reason: string };
type Answer = { session?: unknown; topic?: unknown; reason?: unknown };

const candidateLimit = 10;
const exchangeLength = 500;

function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function firstWords(text: string): string {
  return text.split(/\s+/).slice(0, 6).join(" ");
}

function newSession(topic: string, reason: string): Route {
  return { sessionId: randomUUID(), topic, isNew: true, reason };
}

function parseAnswer(response: string): Answer {
  try {
    const answer: unknown = JSON.parse(response.slice(response.indexOf("{"), response.lastIndexOf("}") + 1));
    return typeof answer === "object" && answer !== null ? answer : {};
  } catch {
    return {};
  }
}

export async function route({ db, config, run }: Deps, text: string): Promise<Route> {
  const sessions = recentSessions(db, candidateLimit);
  const data = {
    message: text,
    sessions: sessions.map((session) => ({
      id: session.sessionId,
      topic: session.topic,
      lastActive: new Date(session.lastActive).toLocaleString(),
      lastMessage: cut(session.text, exchangeLength),
      lastReply: cut(session.result, exchangeLength),
    })),
  };
  const { ok, response, error } = await run({
    prompt: readFileSync(routePromptPath, "utf8") + JSON.stringify(data, null, 2),
    model: config.router.model,
    tools: false,
    contextFiles: false,
  });
  if (!ok) return newSession(firstWords(text), `The router failed: ${error}`);

  const answer = parseAnswer(response);
  const topic = typeof answer.topic === "string" && answer.topic ? answer.topic : firstWords(text);
  const reason = typeof answer.reason === "string" ? answer.reason : "";
  if (answer.session === "new") return newSession(topic, reason);
  const session = sessions.find(({ sessionId }) => sessionId === answer.session);
  if (!session) return newSession(firstWords(text), `The router gave no usable answer: ${cut(response, 200)}`);
  return { sessionId: session.sessionId, topic: session.topic ?? topic, isNew: false, reason };
}
