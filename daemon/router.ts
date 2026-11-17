import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { home, projectsPath, routePromptPath } from "./paths.ts";
import { closedSessions, sessionsActiveSince } from "./sessions.ts";
import type { ClosedSession } from "./sessions.ts";
import type { Role } from "./config.ts";
import type { Deps } from "./worker.ts";

export type Route = {
  sessionId: string;
  topic: string;
  role: Role;
  folder: string;
  isNew: boolean;
  reason: string;
  context: string;
};
type Answer = { session?: unknown; continues?: unknown; topic?: unknown; role?: unknown; folder?: unknown; reason?: unknown };
type Pick = { topic: string; reason: string; continued?: ClosedSession; role?: unknown; folder?: unknown };

const exchangeLength = 500;
const day = 24 * 60 * 60_000;
const offeredDays = 30;
const contextDays = 7;

function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function expandHome(path: string): string {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}

function projectFolders(): string[] {
  const projects = existsSync(projectsPath) ? readFileSync(projectsPath, "utf8") : "";
  return [...projects.matchAll(/^- Path: (.+)$/gm)].map(([, path]) => expandHome(path.trim()));
}

function findFolder(answer: unknown): string {
  if (typeof answer !== "string" || answer === "home") return home;
  const folder = expandHome(answer);
  const listed = projectFolders().some((project) => folder === project || folder.startsWith(project + sep));
  return listed && existsSync(folder) && statSync(folder).isDirectory() ? folder : home;
}

function firstWords(text: string): string {
  return text.split(/\s+/).slice(0, 6).join(" ");
}

function parseAnswer(response: string): Answer {
  try {
    const answer: unknown = JSON.parse(response.slice(response.indexOf("{"), response.lastIndexOf("}") + 1));
    return typeof answer === "object" && answer !== null ? answer : {};
  } catch {
    return {};
  }
}

function shortTermMemory(closed: ClosedSession[], continued: ClosedSession | undefined, now: number): string {
  const recent = closed.filter((session) => session !== continued && session.closedAt >= now - contextDays * day);
  const parts = [
    continued && `This session continues the closed session "${continued.topic}". Where it stood:\n${continued.summary}`,
    recent.length > 0 &&
      `Other sessions that closed in the last ${contextDays} days, newest first:\n` +
        recent
          .map(({ topic, closedAt, summary }) => `- ${topic} (closed ${new Date(closedAt).toLocaleString()}): ${summary}`)
          .join("\n"),
  ].filter(Boolean);
  return parts.length > 0 ? ["## Short-term memory", ...parts].join("\n\n") : "";
}

export async function route({ db, config, run }: Deps, text: string): Promise<Route> {
  const now = Date.now();
  const sessions = sessionsActiveSince(db, now - config.idle.afterMinutes * 60_000);
  const closed = closedSessions(db, now - offeredDays * day);
  const findRole = (name: unknown) =>
    config.roles.find((role) => role.name === name) ??
    (config.roles.find((role) => role.name === config.router.defaultRole) as Role);
  const newSession = ({ topic, reason, continued, role, folder }: Pick): Route => ({
    sessionId: randomUUID(),
    topic,
    role: findRole(role),
    folder: findFolder(folder),
    isNew: true,
    reason,
    context: shortTermMemory(closed, continued, now),
  });

  const data = {
    message: text,
    sessions: sessions.map((session) => ({
      id: session.id,
      topic: session.topic,
      lastActive: new Date(session.lastActiveAt).toLocaleString(),
      lastMessage: cut(session.lastMessage, exchangeLength),
      lastReply: cut(session.lastReply, exchangeLength),
    })),
    closed: closed.map(({ id, topic, summary }) => ({ id, topic, summary })),
    roles: config.roles.map(({ name, use }) => ({ name, use })),
    projects: existsSync(projectsPath) ? readFileSync(projectsPath, "utf8") : "",
  };
  const { ok, response, error } = await run({
    prompt: readFileSync(routePromptPath, "utf8") + JSON.stringify(data, null, 2),
    model: config.router.model,
    tools: false,
    contextFiles: false,
  });
  if (!ok) return newSession({ topic: firstWords(text), reason: `The router failed: ${error}` });

  const answer = parseAnswer(response);
  const topic = typeof answer.topic === "string" && answer.topic ? answer.topic : firstWords(text);
  const reason = typeof answer.reason === "string" ? answer.reason : "";
  if (answer.session === "new") {
    const continued = closed.find(({ id }) => id === answer.continues);
    return newSession({ topic: continued?.topic ?? topic, reason, continued, role: answer.role, folder: answer.folder });
  }
  const session = sessions.find(({ id }) => id === answer.session);
  if (!session) {
    return newSession({ topic: firstWords(text), reason: `The router gave no usable answer: ${cut(response, 200)}` });
  }
  const { id, topic: sessionTopic, role, folder, context } = session;
  return { sessionId: id, topic: sessionTopic, role: findRole(role), folder: folder || home, isNew: false, reason, context };
}
