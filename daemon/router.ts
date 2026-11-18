import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { home, projectsPath, routePromptPath } from "./paths.ts";
import { describeSummaries, findSession, recentMessages, shortTermMemory } from "./sessions.ts";
import type { Session, SummarizedSession } from "./sessions.ts";
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
type Answer = { follows?: unknown; topic?: unknown; role?: unknown; folder?: unknown; reason?: unknown };
type Pick = { topic: string; reason: string; continued?: Session; role?: unknown; folder?: unknown };

const exchangeLength = 500;
const recentCount = 10;

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

function contextFor(continued: Session | undefined, summaries: SummarizedSession[]): string {
  const others = summaries.filter(({ id }) => id !== continued?.id);
  const parts = [
    continued &&
      (continued.summary
        ? `This conversation continues "${continued.topic}". Where it stood:\n\n${continued.summary}`
        : `This conversation continues "${continued.topic}".`),
    others.length > 0 && `Other recent work, newest first:\n\n${describeSummaries(others)}`,
  ].filter(Boolean);
  return parts.length > 0 ? ["## Recent work", ...parts].join("\n\n") : "";
}

export async function route({ db, config, run }: Deps, text: string): Promise<Route> {
  const messages = recentMessages(db, recentCount);
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
    context: contextFor(continued, shortTermMemory(db)),
  });

  const data = {
    message: text,
    recent: messages.map(({ id, topic, at, message, reply }) => ({
      id,
      topic,
      at: new Date(at).toLocaleString(),
      message: cut(message, exchangeLength),
      reply: cut(reply, exchangeLength),
    })),
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
  const reason = typeof answer.reason === "string" ? answer.reason : "";
  if (answer.follows === "none") {
    const topic = typeof answer.topic === "string" && answer.topic ? answer.topic : firstWords(text);
    return newSession({ topic, reason, role: answer.role, folder: answer.folder });
  }
  const followed = messages.find(({ id }) => String(id) === String(answer.follows));
  const session = followed && findSession(db, followed.sessionId);
  if (!session) {
    return newSession({ topic: firstWords(text), reason: `The router gave no usable answer: ${cut(response, 200)}` });
  }
  if (session.lastActiveAt < Date.now() - config.idle.afterMinutes * 60_000) {
    return newSession({ topic: session.topic, reason, continued: session, role: session.role, folder: session.folder });
  }
  const { id, topic, role, folder, context } = session;
  return { sessionId: id, topic, role: findRole(role), folder: folder || home, isNew: false, reason, context };
}
