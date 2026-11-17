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
npm run status                  # list pending, running and recent messages, and recently closed sessions
```

mei does one thing at a time, oldest first: a message waits while an earlier message, a scheduled run or a session being written into memory is in progress.

mei keeps one session per task. For every message it decides whether you are continuing an open session or starting a new one, and prints the session's topic and role in brackets before the answer:

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

A subject outlives its sessions through memory. When a session closes, mei saves what is worth keeping to `memory/` in its home and writes a short summary of the session. A new session is given the summaries of the sessions closed in the last seven days, so coming back to a subject picks up where it stood:

```
$ npm run -s chat -- "Plan a three-day trip to Kyoto. One theme per day."
[Kyoto trip plan · chat]
Day 1: temples ...
$ # more than 30 minutes later
$ npm run -s chat -- "For the Kyoto trip, swap day one and day three."
[Kyoto trip plan · chat]
Day 1 is now ...
```

The instructions for writing a session into memory are in `prompts/summarize.md` in the home.

The topic and the debug output go to stderr, so `npm run -s chat -- "hi" 2>/dev/null` prints the answer alone. Ctrl-C stops waiting; the message is still answered, and `npm run status` shows the result.

## Reset memory

With the daemon running, use `npm run reset -- --yes` to permanently clear memory, chat transcripts, session summaries, logs and the inbox. There is no undo. Settings, instructions, projects, skills and prompts are kept; schedules start fresh. If mei is working, wait for it to finish before resetting.

## Home

Everything that belongs to your mei is in one directory, `~/.local/share/mei`. Set `MEI_HOME` to keep it somewhere else.

| Path | What it is |
|---|---|
| `AGENTS.md` | operating instructions |
| `CHARACTER.md` | assistant name, language, tone and speaking style |
| `PROJECTS.md` | the locations on your machine and what each is for |
| `config.toml` | settings |
| `prompts/` | `summarize.md`, `dream.md` and the prompts of your own schedules |
| `memory/` | what mei remembers about you and your unfinished tasks |
| `.agents/skills/` | mei's skills |
| `state/` | what the daemon stores, described below |

When the daemon starts, it copies each of these files that is missing from `template/` in this checkout. A file that exists is left alone, so the home is yours to edit. Scheduled runs and memory writing start in the home; a chat session starts in the folder the router picked for it.

Edit `CHARACTER.md` to change the assistant's identity and communication preferences. It is read for every answer, so changes apply to the next message without restarting the daemon. Memory reset preserves it. The executable and service remain named `mei`, regardless of the assistant's name. Keep operating instructions in `AGENTS.md` and identity and communication preferences in `CHARACTER.md`.

`state/` holds the message history and session summaries in `mei.db`, the conversations in `sessions/chat/`, and the routing decision and full event stream of each answer and scheduled run in `logs/<message number>.jsonl`. For an answer, the log ends with a `mei_voice` line holding the working agent's `original` answer and the `voiced` one you received; compare them to improve `CHARACTER.md`.

## Configuration

`config.toml` in the home holds the settings. After editing it, run `mei reload` (or `npm run reload`) to apply changes without restarting the daemon. Invalid configuration reports an error and leaves the current settings and timers unchanged.

Reload updates roles, models, character settings, idle timeouts and schedules. Unchanged schedule times are preserved; changed intervals start from the reload time. Active idle timers are adjusted to the new timeout. Work already running finishes with its original settings; queued work uses the new settings. Already queued scheduled runs keep their original schedule payload.

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
enabled = true           # rewrite each answer in the voice of CHARACTER.md; false sends the working agent's answer as is
model = "anthropic/claude-haiku-5-5"   # model that does the rewriting

[idle]
after_minutes = 30       # a session this quiet is closed and written into memory; a later message starts a new session
model = "anthropic/claude-haiku-5-5"   # model that writes a closed session into memory
```

Each message goes through up to three runs:

1. The router picks the session. For a new session it also picks a role, from the roles' `use`, and a folder: a `Path` from `PROJECTS.md`, a folder inside one, or the home. The session keeps its role and folder until it closes; a session that continues a closed one gets a fresh pick.
2. The working agent does the task with the role's model. It is plain Pi started in the session's folder, so it follows that folder's `AGENTS.md` and skills, the same as running `pi-bolt` there yourself. It also gets the short-term memory.
3. With `[character] enabled`, the voice rewrites the answer as `CHARACTER.md` asks, seeing the last two exchanges of the session. It has no tools. The default `CHARACTER.md` asks it to keep code, commands, paths and numbers exactly. If it fails, you get the working agent's answer.

Memory is written from the working agent's transcript, so it holds the original answers. The voice follows `CHARACTER.md` alone. The instructions for the router's decision are in `prompts/route.md` in this checkout.

## Schedules

mei runs a prompt on a schedule when `config.toml` has a block for it. The file ships one, the nightly `dream` schedule described below.

```toml
# Each [[schedule]] needs a unique name, a prompt file relative to the home,
# and exactly one of daily_at or every_minutes.
[[schedule]]
name = "dream"
prompt = "prompts/dream.md"
daily_at = "03:00"       # local time HH:MM; or: every_minutes = 60
model = ""               # model for this job; empty uses Pi's default
notify = false           # keep this job's results out of the listen stream; left out means true
```

Every run starts a fresh conversation that is not kept. A run that was due while the daemon was stopped happens once when the daemon starts.

A prompt file is plain text. mei replaces these placeholders before the run, and any other `{{name}}` fails the run:

| Placeholder | Replaced with |
|---|---|
| `{{now}}` | the current local date and time |
| `{{last_run}}` | when this schedule last ran successfully, as a UTC timestamp like `2026-01-31T19:00:00.000Z`, or `never` |
| `{{sessions_dir}}` | the absolute path of the directory holding one `.jsonl` transcript per chat session |

```sh
npm run job -- dream            # run a schedule now
npm run status                  # also lists each schedule with its next run
```

### Dream

At 03:00 local time, `dream` consolidates chat transcripts into notes and task files, and updates `memory/MEMORY.md`. Its instructions are in `prompts/dream.md`.

A failed run leaves `{{last_run}}` unchanged, so the next run covers the same transcripts again.

## Receiving results

A program receives the result of each scheduled run as it finishes by subscribing to the daemon. `npm run listen` is such a subscriber: it prints every result as one JSON line, with the answer in `result`, or the reason in `error` when the run failed.

```sh
npm run -s listen | while read -r event; do
  notify-send "mei" "$(jq -r '.result // .error' <<<"$event")"
done
```

A schedule with `notify = false` is left out, which is how `dream` stays silent. Chat answers and session summaries are never sent.

Results are kept while nothing is subscribed. `npm run listen -- --after <event number>` first prints the results that finished after that event, taking the number from the `id` of the last line you received or from `npm run status`. Without `--after`, only results from now on are printed. The command runs until you stop it: while the daemon is stopped it waits, then continues after the last result it printed.

To subscribe from your own program, connect to the Unix socket `state/mei.sock` in the home and send one line, `{"type":"listen"}` or `{"type":"listen","after":12}`. The daemon sends one JSON line per result until you close the connection.

## Running

The daemon is the one long-lived process: it holds the message queue, fires schedules, closes quiet sessions and starts an agent run for each of them. Every other command is a small client that talks to it, so nothing works while it is stopped.

| Command | What it does |
|---|---|
| `npm run daemon` | start the daemon in the foreground |
| `npm run chat -- "<prompt>"` | send a message and print the answer |
| `npm run status` | list schedules, closed sessions and recent messages |
| `npm run reload` | apply configuration changes without restarting |
| `npm run reset -- --yes` | permanently clear memory, history, logs and the inbox |
| `npm run job -- <schedule name>` | run a schedule now |
| `npm run listen` | print the result of each scheduled run as it finishes |

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

The `mei` subcommands talk to the running daemon over its Unix socket; they do not start another daemon. `mei chat` and `mei status` are the same clients as `npm run chat` and `npm run status`. `mei reset --yes` clears the daemon's memory, history, logs and inbox. `mei job <schedule name>` and `mei listen [--after <event number>]` are also available. Run `mei --help` for usage.

`make uninstall` stops the service and removes both files.

The full record of each answer and scheduled run is in `state/logs/` in the home.
