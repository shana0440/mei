---
name: background
description: Hand a task to a background run that reports back when done, now or at a set time, or have a reminder said at a set time. Use when a task will take more than a few minutes, or the user wants something done or said later.
---

# Background

A background task runs once, as a new session in this session's role and folder, and its result reaches the user on its own when it is ready. Run the commands below with the bash tool, so mei knows which session started the task.

1. Write the prompt so it stands alone: the background session does not see this conversation. Put in it everything it needs: what to do, the sources, names, files and constraints the user gave, and what the result should look like.
2. Start it:
   - Now: `mei background add "<prompt>"`
   - At a time: `mei background add --at <time> "<prompt>"`
   - A reminder, said as written at that time with no agent run: `mei background add --at <time> --say "<what to tell the user>"`

   `<time>` is local time as `YYYY-MM-DDTHH:MM`. Work it out from the user's words and `date`; for "in 20 minutes", use `date -d '+20 minutes' +%Y-%m-%dT%H:%M`. For several times, such as "for the next two days", add one task per time. Something that repeats with no end is a schedule: follow the `schedule` skill in place of this one.
3. Answer the user: what will run and when, and that the result comes on its own. If the command warns that nothing is listening, tell the user the result waits until something listens with `mei listen`, so a reminder will not reach them by itself.

`mei background list` shows waiting, queued and running tasks with their numbers. `mei background cancel <number>` drops a waiting task or stops a running one. A run longer than `[background] timeout_minutes` in `config.toml` is stopped and its error is sent to the user.
