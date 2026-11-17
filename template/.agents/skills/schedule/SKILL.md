---
name: schedule
description: Add, change or remove a scheduled job in config.toml. Use when the user asks for something to run on its own at a time or on an interval.
---

# Schedule

mei's home is three levels up from this file's directory. Paths below are relative to it.

1. Pick the kind of job:
   - A command, when a script can produce the result alone: fetching, filtering, checking, formatting. It runs with no model.
   - A prompt, when the job needs judgment, writing or tools an agent would use.
   - Both, when a script can fetch the data and the agent only needs to judge or write about it. The command runs first and its stdout goes to the prompt as `{{output}}`.
2. Write the job:
   - Command: write the script in `scripts/`, make it executable and run it once from the home. It prints the result to stdout and exits non-zero with the reason on stderr on failure. `MEI_LAST_RUN` holds when it last succeeded, as a UTC timestamp or `never`.
   - Prompt: write it in `prompts/<name>.md`. It may use `{{now}}`, `{{last_run}}`, `{{sessions_dir}}` and, with a command, `{{output}}`; any other `{{name}}` fails the run.
3. Add a block to `config.toml`:

   ```toml
   [[schedule]]
   name = "<unique name>"
   command = "scripts/<name>.sh"   # a command, a prompt or both
   prompt = "prompts/<name>.md"
   daily_at = "08:00"              # local time HH:MM; or: every_minutes = 60
   ```

   Optional keys: `notify = false` keeps the results from the user; `model = "provider/id"` for a prompt; `timeout_minutes` for a command, 10 when left out.
4. Run `mei reload`. When it reports an error, fix `config.toml` and reload again.
5. Run `mei job <name>`. A command runs right away: check its result with `mei status`. A prompt, including the prompt half of a schedule with both, runs after your answer, since agent runs go one at a time.
6. Show the user the block and the result of the test run, or of your own run of the script and prompt.

To remove a schedule, delete its block, reload, and delete its script or prompt.
