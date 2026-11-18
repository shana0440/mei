# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24 and [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) (`pi-bolt` on your PATH, signed in to a model provider). With Nix, `nix-shell` provides both.

```sh
npm install
npm run daemon
```

The first start creates mei's home, `~/.local/share/mei`, described under [Home](#home). With the daemon running, in another terminal:

```sh
npm run chat -- "hi"            # send mei a message and print its answer
npm run chat -- --debug "hi"    # also show where the message went and the work as it happens
npm run status                  # list pending, running and recent messages, and the sessions in short-term memory
```

mei does one agent run at a time, oldest first: a message waits while an earlier message, a scheduled prompt, a closing session being summarized or [dream](#dream) is in progress. [Command schedules](#schedules) need no agent and run alongside.

mei keeps one session per task. For every message it looks at the last 10 messages, the way you see them in a chat, and decides whether you are following up on one of them or starting a new task. It prints the session's topic and role in brackets before the answer:

```
$ npm run -s chat -- "Remember the word walrus for a word game. Reply ok."
[Remember word walrus · chat]
ok
$ npm run -s chat -- "What is 17 times 3? Just the number."
[Multiply 17 by 3 · chat]
51
$ npm run -s chat -- "Back to the word game: spell the word backwards."
[Remember word walrus · chat]
s-u-r-l-a-w
```

A session stays open for 30 minutes after its last message (`[idle] after_minutes`). After that the session is closed, and a message on the same subject starts a new session, which does not see the old conversation. This keeps sessions short, so a message never pays to reload a long conversation whose prompt cache has expired.

A subject outlives its sessions through memory, in two kinds. When a session closes, mei writes a detailed summary of it: what you asked, what was decided, your corrections and what is left. These summaries are short-term memory, and every new session is given them, so coming back to a subject picks up where it stood:

```
$ npm run -s chat -- "Plan a three-day trip to Kyoto. One theme per day."
[Kyoto trip plan · chat]
Day 1: temples ...
$ # more than 30 minutes later
$ npm run -s chat -- "For the Kyoto trip, swap day one and day three."
[Kyoto trip plan · chat]
Day 1 is now ...
```

Every night, [dream](#dream) consolidates the summaries into long-term memory, the notes and task files in `memory/` in the home, and they leave short-term memory. A new session reads long-term memory as it needs it. Following up on a session whose summary is already consolidated carries over only its topic. The instructions for the summary are in `prompts/summarize.md` in the home.

What must not wait for a session to close, mei writes down at once in `notebooks/` in the home: something you ask it to remember, a correction, a decision. A session opened a minute later can already read it. Memory stays what mei relies on: each night dream brings `memory/` up to date with what the notebooks hold that still matters, and leaves the notebooks as they are, a record mei looks things up in. Until then, the summaries of closed sessions carry changes to new sessions, and they override `memory/` where the two differ. The instructions for writing it are under "Notebooks" in `AGENTS.md` in the home.

The topic and the debug output go to stderr, so `npm run -s chat -- "hi" 2>/dev/null` prints the answer alone. Ctrl-C stops waiting; the message is still answered, and `npm run status` shows the result.

## Reset memory

With the daemon running, use `npm run reset -- --yes` to permanently clear memory, notebooks, chat transcripts, session summaries, logs and the inbox. There is no undo. Settings, instructions, projects, skills and prompts are kept; schedules start fresh. If mei is working, wait for it to finish before resetting.

## Home

Everything that belongs to your mei is in one directory, `~/.local/share/mei`. Set `MEI_HOME` to keep it somewhere else.

| Path | What it is |
|---|---|
| `AGENTS.md` | operating instructions |
| `CHARACTER.md` | the default character: language, tone and speaking style |
| `PROJECTS.md` | the locations on your machine and what each is for |
| `config.toml` | settings |
| `prompts/` | `summarize.md`, `dream.md` and the prompts of your own schedules |
| `memory/` | what mei remembers about you and your unfinished tasks |
| `notebooks/` | what mei wrote down during a conversation, to look up what it does not remember |
| `.agents/skills/` | mei's skills |
| `state/` | what the daemon stores, described below |

When the daemon starts, it copies each of these files that is missing from `template/` in this checkout. A file that exists is left alone, so the home is yours to edit. Scheduled runs and memory writing start in the home; a chat session starts in the folder the router picked for it.

Edit `CHARACTER.md` to change the assistant's communication preferences. To keep several characters, write each in its own file and point `[character] file` at the one to use. The file is read for every answer, so changes apply to the next message without restarting the daemon. Memory reset preserves it. The executable and service remain named `mei`, regardless of the assistant's name. Keep operating instructions in `AGENTS.md` and identity and communication preferences in `CHARACTER.md`.

`state/` holds the message history and session summaries in `mei.db`, the conversations in `sessions/chat/`, and the routing decision and full event stream of each answer and scheduled run in `logs/<message number>.jsonl`. For an answer and a notified scheduled result, the log ends with a `mei_voice` line holding the working agent's `original` answer and the `voiced` one you received; compare them to improve `CHARACTER.md`.

## Configuration

`config.toml` in the home holds the settings. Change them with `mei config`:

```sh
mei config                                    # open config.toml in $VISUAL or $EDITOR
mei config get character.file                 # print one value, as <table>.<key>
mei config set character.file characters/pirate.md
```

Both `mei config` and `set` check the result the same way the daemon does before saving it, and reload the daemon if it is running. When the check fails, `mei config` offers to reopen your draft, and `set` changes nothing. `set` keeps the rest of the file and its comments as they are; a value is read as TOML when it is one (`true`, `45`, `"quoted"`) and as text otherwise. Schedules are changed with `mei schedule` or in the editor. `mei config` also works while the daemon is stopped, which is how to fix a config that keeps it from starting.

If you edit `config.toml` yourself, run `mei reload` (or `npm run reload`) to apply the changes without restarting the daemon. Invalid configuration reports an error and leaves the current settings and timers unchanged.

Reload updates roles, models, character settings, idle timeouts, the dream time and schedules. Unchanged schedule times are preserved; changed intervals start from the reload time. Active idle timers are adjusted to the new timeout. Work already running finishes with its original settings; queued work uses the new settings. Already queued scheduled runs keep their original schedule payload.

`AGENTS.md`, `CHARACTER.md`, `PROJECTS.md`, skills and prompt files are read on each relevant agent run, so edits need no restart or reload. A running agent is not interrupted, and reload does not clear session history or memory. Changes to `MEI_HOME`, the service environment or daemon code still require a restart.

```toml
[roles.chat]                 # one block per role; add as many as you like
model = "anthropic/claude-haiku-5-5"   # model for this role, as provider/id; empty uses Pi's default
use = "casual conversation, quick questions, language practice"   # tells the router when to pick it

[roles.coder]
model = "anthropic/claude-opus-5-5"
use = "writing or changing code, debugging"

[router]
model = "anthropic/claude-haiku-5-5"   # model that decides which session a message belongs to
default_role = "chat"    # role used when the router fails or picks no known role

[character]
name = "Mei"             # the name the voice answers as
file = "CHARACTER.md"    # the character to speak as, relative to the home; point it at another file to switch
enabled = true           # rewrite each answer in the voice of the character file; false sends the working agent's answer as is
model = "anthropic/claude-haiku-5-5"   # model that does the rewriting

[idle]
after_minutes = 30       # a session this quiet is closed and summarized; a later message starts a new session
model = "anthropic/claude-haiku-5-5"   # model that summarizes a closed session

[dream]
daily_at = "03:00"       # local time HH:MM when the day's summaries are written into memory/
model = "anthropic/claude-haiku-5-5"   # model that writes them
```

Each message goes through up to three runs:

1. The router picks the session. For a new session it also picks a role, from the roles' `use`, and a folder: a `Path` from `PROJECTS.md`, a folder inside one, or the home. The session keeps its role and folder, and so does a new session that continues a closed one.
2. The working agent does the task with the role's model. It is plain Pi started in the session's folder, so it follows that folder's `AGENTS.md` and skills, the same as running `pi-bolt` there yourself. It also gets the short-term memory.
3. With `[character] enabled`, the voice rewrites the answer as the character file asks, under the `name` set in `[character]`. It sees the last four things it said to you across all topics, chat answers and scheduled results alike, with how long ago each was, so it can tell when it is changing the subject. It has no tools. The default `CHARACTER.md` asks it to keep code, commands, paths and numbers exactly. If it fails, you get the working agent's answer.

Summaries are written from the working agent's transcript, so memory holds the original answers. The voice follows the character file and its `name` alone. The instructions for the router's decision are in `prompts/route.md` in this checkout.

## Dream

At `[dream] daily_at`, 03:00 by default, dream writes the summaries waiting in short-term memory into the notes and task files in `memory/`, and updates `memory/MEMORY.md`. When it succeeds, those summaries leave short-term memory; summaries written during the run wait for the next one. A failed run keeps them for the next night. With no summaries waiting, it does not run. `npm run status` shows how many are waiting, and `npm run dream` runs it now. Its instructions are in `prompts/dream.md` in the home.

## Schedules

mei runs a prompt or a command on a schedule when `config.toml` has a block for it.

```toml
# Each [[schedule]] needs a unique name, a prompt, a command or both,
# and exactly one of daily_at or every_minutes.
[[schedule]]
name = "standup"
prompt = "prompts/standup.md"
daily_at = "09:00"       # local time HH:MM; or: every_minutes = 60
role = "chat"            # the prompt runs with this role's model; left out means router.default_role
notify = false           # keep this job's results out of the listen stream; left out means true
```

Pick the role whose `use` fits the job, so changing a role's model moves its schedules too. To give one schedule its own model, write `model = "provider/id"` in place of `role`.

A command schedule runs without an agent, for jobs that need no model:

```toml
[[schedule]]
name = "reddit-top"
command = "scripts/reddit-top.sh"   # run with sh -c in the home
every_minutes = 60
timeout_minutes = 5      # stop it, with everything it started, after this long; left out means 10
```

It runs as soon as it is due, without waiting for agent runs, and at most one run of each command schedule runs at a time. Its trimmed stdout is the result. A non-zero exit or the time limit fails the run with stderr as the error. `MEI_LAST_RUN` holds the same value as `{{last_run}}`. The log in `state/logs/` holds the exit status, stdout and stderr.

A schedule with both runs the command first and hands its stdout to the prompt as `{{output}}`, so a script can fetch the data and the agent only judges it:

```toml
[[schedule]]
name = "reddit-funniest"
command = "scripts/reddit-top.sh"
prompt = "prompts/reddit-funniest.md"   # "Pick the funniest of these posts: {{output}}"
daily_at = "09:00"
```

The command runs as soon as it is due; the prompt then waits its turn with the other agent runs, and its answer is the result. A failed command fails the run without starting the agent. Until the prompt runs, `npm run status` shows the command's output for the run.

Ask mei to schedule something and it writes the script or prompt and adds the schedule, following the `schedule` skill in the home.

Every prompt run starts a fresh conversation that is not kept. A run that was due while the daemon was stopped happens once when the daemon starts.

A prompt file is plain text. mei replaces these placeholders before the run, and any other `{{name}}` fails the run:

| Placeholder | Replaced with |
|---|---|
| `{{now}}` | the current local date and time |
| `{{last_run}}` | when this schedule last ran successfully, as a UTC timestamp like `2026-01-31T19:00:00.000Z`, or `never` |
| `{{sessions_dir}}` | the absolute path of the directory holding one `.jsonl` transcript per chat session |
| `{{output}}` | the stdout of the schedule's command; only in a schedule that has one |

```sh
npm run job -- standup          # run a schedule now
npm run status                  # also lists each schedule with its next run
```

### Managing schedules

```sh
npm run schedule -- add "every morning at 8, the top post of r/programming"
npm run schedule -- list                # every schedule: enabled or disabled, when it runs, its next run
npm run schedule -- disable standup     # stop it firing; its block stays in config.toml
npm run schedule -- enable standup
npm run schedule -- remove standup      # delete its block; its script or prompt stays
```

`add` sends the description to mei as a chat message, and mei follows the `schedule` skill: it decides on a command, a prompt or both, writes the script or prompt, adds the block, reloads, runs the job once and answers with what it made.

`remove`, `enable` and `disable` change the block in `config.toml` and apply it to the running daemon, the same as editing the file and running `mei reload`. An unknown name is reported, and an invalid `config.toml` is reported and left unchanged.

A disabled schedule has `enabled = false` in its block. It never fires on its own, and runs it missed while disabled are not made up, but `npm run job -- <name>` still runs it. Enabling it again schedules its next run from then.

## Receiving results

A program receives the result of each scheduled run as it finishes by subscribing to the daemon. `npm run listen` is such a subscriber: it prints every result as one JSON line, with the answer in `result`, or the reason in `error` when the run failed.

```sh
npm run -s listen | while read -r event; do
  notify-send "mei" "$(jq -r '.result // .error' <<<"$event")"
done
```

With `[character] enabled`, the voice rewrites each result before it is sent, the same way as a chat answer. A result that arrives while you are in the middle of a conversation comes as an aside, so it does not mix into that conversation. A failed run sends its error as is.

A schedule with `notify = false` is left out and not voiced. Chat answers, session summaries and dream are never sent.

Results are kept while nothing is subscribed. `npm run listen -- --after <event number>` first prints the results that finished after that event, taking the number from the `id` of the last line you received or from `npm run status`. Without `--after`, only results from now on are printed. The command runs until you stop it: while the daemon is stopped it waits, then continues after the last result it printed.

To subscribe from your own program, connect to the Unix socket `state/mei.sock` in the home and send one line, `{"type":"listen"}` or `{"type":"listen","after":12}`. The daemon sends one JSON line per result until you close the connection.

## Running

The daemon is the one long-lived process: it holds the message queue, fires schedules, closes quiet sessions and starts an agent run for each of them. Every other command is a small client that talks to it, so nothing but `config` works while it is stopped.

| Command | What it does |
|---|---|
| `npm run daemon` | start the daemon in the foreground |
| `npm run chat -- "<prompt>"` | send a message and print the answer |
| `npm run status` | list schedules, short-term memory and recent messages |
| `npm run reload` | apply configuration changes without restarting |
| `npm run reset -- --yes` | permanently clear memory, history, logs and the inbox |
| `npm run job -- <schedule name>` | run a schedule now |
| `npm run dream` | write the waiting summaries into memory now |
| `npm run listen` | print the result of each scheduled run as it finishes |
| `npm run schedule -- <list\|add\|remove\|enable\|disable>` | [manage schedules](#managing-schedules) |
| `npm run config -- [get <key> \| set <key> <value>]` | [change settings](#configuration) |

To keep the daemon running whenever you are logged in, and to chat from any directory, install it as a systemd user service with a `mei` command:

```sh
make install                    # with Nix: nix-shell --run "make install"
mei chat "hi"
mei status
mei reload                     # apply changes to config.toml
mei reset --yes                 # permanently clear memory, history, logs and inbox
journalctl --user -u mei        # what the daemon printed
```

`make install` runs `npm install`, then writes `~/.config/systemd/user/mei.service` and `~/.local/bin/mei` for this checkout, and starts the service (restarting it if it was already running). The service gets the `PATH` of the shell that ran `make install`, and mei can only use tools found on it. Run `make install` again after moving the checkout or changing where `node` and `pi-bolt` are installed.

The `mei` subcommands talk to the running daemon over its Unix socket; they do not start another daemon. `mei chat` and `mei status` are the same clients as `npm run chat` and `npm run status`. `mei reset --yes` clears the daemon's memory, history, logs and inbox. `mei job <schedule name>`, `mei dream`, `mei listen [--after <event number>]` and `mei schedule ...` are also available. Run `mei --help` for usage.

`make uninstall` stops the service and removes both files.

The full record of each answer and scheduled run is in `state/logs/` in the home.
