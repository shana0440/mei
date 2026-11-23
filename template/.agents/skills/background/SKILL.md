---
name: background
description: Hand a task to a background run that reports back when done, now or at a set time, have a reminder said at a set time, or have mei watch a long script. Use when a task will take more than a few minutes, the user wants something done or said later, or a script you start will run longer than a few minutes.
---

# Background

A background task runs once, as a new session in this session's role and folder, and mei records its result as an assistant reply in the originating conversation. Run the commands below with the bash tool, so mei knows which session started the task.

1. Write the prompt so it stands alone: the background session does not see this conversation. Put in it everything it needs: what to do, the sources, names, files and constraints the user gave, and what the result should look like.
2. Start it:
   - Now: `mei background add "<prompt>"`
   - At a time: `mei background add --at <time> "<prompt>"`
   - A reminder, said as written at that time with no agent run: `mei background add --at <time> --say "<what to tell the user>"`

   `<time>` is local time as `YYYY-MM-DDTHH:MM`. Work it out from the user's words and `date`; for "in 20 minutes", use `date -d '+20 minutes' +%Y-%m-%dT%H:%M`. For several times, such as "for the next two days", add one task per time. Something that repeats with no end is a schedule: follow the `schedule` skill in place of this one.
3. Answer the user: what will run and when, and that mei will record the result in the conversation.

## Long scripts

Never leave a process running when your turn ends (`&`, `nohup`, `setsid`): nobody would notice it fail or finish. A script that runs longer than a few minutes, such as training a model or processing many large files, is for mei to watch:

```sh
mei background watch "<command>"
```

mei runs it with `sh -c` in the current folder with no time limit, writes its output to the file the command prints, and keeps it running when the daemon restarts. When it ends, successfully or not, mei wakes this session with its exit status and the end of its output. Then check whether it did what it was meant to do; if not, fix it and watch it again, and report what came of it. Tell the user it is running and that mei will record the follow-up in the conversation.

`mei background list` shows waiting, queued and running tasks with their numbers. `mei background cancel <number>` drops a waiting task or stops a running one or a watched script. A run longer than `[background] timeout_minutes` in `config.toml` is stopped and its error is sent to the user.
