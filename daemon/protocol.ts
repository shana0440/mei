import type { InboxEvent, NewEvent } from "./inbox.ts";

export type Requests = {
  "event.add": { message: { event: NewEvent }; reply: { id: number } };
  status: { message: {}; reply: { events: InboxEvent[] } };
};

export type RequestType = keyof Requests;
export type Message<T extends RequestType> = { type: T } & Requests[T]["message"];
export type Reply<T extends RequestType> = Requests[T]["reply"];
