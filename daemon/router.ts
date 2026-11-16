import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { routePromptPath } from "./paths.ts";
import { sessionsActiveSince } from "./sessions.ts";
import type { Deps } from "./worker.ts";

export type Route = { sessionId: string; topic: string; isNew: boolean; reason: string };
type Answer = { session?: unknown; topic?: unknown; reason?: unknown };

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
  const sessions = sessionsActiveSince(db, Date.now() - config.idle.afterMinutes * 60_000);
  const data = {
    message: text,
    sessions: sessions.map((session) => ({
      id: session.id,
      topic: session.topic,
      lastActive: new Date(session.lastActiveAt).toLocaleString(),
      lastMessage: cut(session.lastMessage, exchangeLength),
      lastReply: cut(session.lastReply, exchangeLength),
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
  const session = sessions.find(({ id }) => id === answer.session);
  if (!session) return newSession(firstWords(text), `The router gave no usable answer: ${cut(response, 200)}`);
  return { sessionId: session.id, topic: session.topic, isNew: false, reason };
}
