import type { Schedule } from "./config.ts";
import type { InboxEvent } from "./inbox.ts";
import type { ScheduleChange } from "./schedules.ts";
import type { SummarizedSession } from "./sessions.ts";
import type { Timer } from "./timers.ts";

export type ScheduleListing = Schedule & { dueAt: number | null };

export type Requests = {
  chat: { message: { text: string; debug?: boolean }; reply: { result: string; topic: string } };
  job: { message: { name: string }; reply: { eventId: number } };
  dream: { message: {}; reply: { eventId: number } };
  reset: { message: {}; reply: {} };
  reload: { message: {}; reply: {} };
  listen: { message: { after?: number }; reply: {} };
  status: { message: {}; reply: { events: InboxEvent[]; timers: Timer[]; shortTerm: SummarizedSession[] } };
  schedules: { message: {}; reply: { schedules: ScheduleListing[] } };
  schedule: { message: { change: ScheduleChange }; reply: {} };
  task: {
    message: { text: string; at?: number; say?: boolean; fromSession?: string };
    reply: { eventId: number; listening: boolean };
  };
  tasks: { message: {}; reply: { tasks: InboxEvent[]; timeoutMinutes: number } };
  cancel: { message: { eventId: number }; reply: {} };
};

export type RequestType = keyof Requests;
export type Message<T extends RequestType> = { type: T } & Requests[T]["message"];
export type Reply<T extends RequestType> = Requests[T]["reply"];
