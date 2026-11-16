import type { InboxEvent } from "./inbox.ts";

export type Requests = {
  chat: { message: { text: string }; reply: { id: number } };
  status: { message: {}; reply: { events: InboxEvent[] } };
};

export type RequestType = keyof Requests;
export type Message<T extends RequestType> = { type: T } & Requests[T]["message"];
export type Reply<T extends RequestType> = Requests[T]["reply"];
