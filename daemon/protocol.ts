import type { InboxEvent } from "./inbox.ts";
import type { ClosedSession } from "./sessions.ts";
import type { Timer } from "./timers.ts";

export type Requests = {
  chat: { message: { text: string; debug?: boolean }; reply: { result: string; topic: string } };
  job: { message: { name: string }; reply: { eventId: number } };
  reset: { message: {}; reply: {} };
  reload: { message: {}; reply: {} };
  listen: { message: { after?: number }; reply: {} };
  status: { message: {}; reply: { events: InboxEvent[]; timers: Timer[]; closed: ClosedSession[] } };
};

export type RequestType = keyof Requests;
export type Message<T extends RequestType> = { type: T } & Requests[T]["message"];
export type Reply<T extends RequestType> = Requests[T]["reply"];
