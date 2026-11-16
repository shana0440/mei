# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24 and [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) (`pi-bolt` on your PATH, signed in to a model provider). With Nix, `nix-shell` provides both.

```sh
npm install
npm run daemon
```

With the daemon running, in another terminal:

```sh
npm run chat -- "hi"            # send mei a message and print its answer
npm run chat -- --debug "hi"    # also show where the message went and the work as it happens
npm run status                  # list pending, running and recent messages, and recently closed sessions
```

mei does one thing at a time, oldest first: a message waits while an earlier message, a scheduled run or a session being written into memory is in progress.

mei keeps one session per task. For every message it decides whether you are continuing an open session or starting a new one, and prints the session's topic in brackets before the answer:

```
$ npm run -s chat -- "Remember the word walrus for a word game. Reply ok."
[Remember word walrus]
ok
$ npm run -s chat -- "What is 17 times 3? Just the number."
[Multiply 17 by 3]
51
$ npm run -s chat -- "Back to the word game: spell the word backwards."
[Remember word walrus]
s-u-r-l-a-w
```

A session stays open for 30 minutes after its last message (`[idle] after_minutes`). After that the session is closed, and a message on the same subject starts a new session, which does not see the old conversation. This keeps sessions short, so a message never pays to reload a long conversation whose prompt cache has expired.

A subject outlives its sessions through memory. When a session closes, mei saves what is worth keeping to `memory/` and writes a short summary of the session. A new session is given the summaries of the sessions closed in the last seven days, so coming back to a subject picks up where it stood:

```
$ npm run -s chat -- "Plan a three-day trip to Kyoto. One theme per day."
[Kyoto trip plan]
Day 1: temples ...
$ # more than 30 minutes later
$ npm run -s chat -- "For the Kyoto trip, swap day one and day three."
[Kyoto trip plan]
Day 1 is now ...
```

The instructions for writing a session into memory are in `prompts/summarize.md`.

The topic and the debug output go to stderr, so `npm run -s chat -- "hi" 2>/dev/null` prints the answer alone. Ctrl-C stops waiting; the message is still answered, and `npm run status` shows the result.

## Configuration

`config.toml` holds the settings. Restart the daemon after changing it.

```toml
[chat]
model = "anthropic/claude-haiku-5-5"   # model for chat runs, as provider/id; empty uses Pi's default

[router]
model = "anthropic/claude-haiku-5-5"   # model that decides which session a message belongs to

[idle]
after_minutes = 30       # a session this quiet is closed and written into memory; a later message starts a new session
model = "anthropic/claude-haiku-5-5"   # model that writes a closed session into memory
```

The instructions for that decision are in `prompts/route.md`.

## Schedules

mei runs a prompt on a schedule when `config.toml` has a block for it. The file ships one, the nightly `dream` schedule described below.

```toml
# Each [[schedule]] needs a unique name, a prompt file relative to the project
# root, and exactly one of daily_at or every_minutes.
[[schedule]]
name = "dream"
prompt = "prompts/dream.md"
daily_at = "03:00"       # local time HH:MM; or: every_minutes = 60
model = ""               # model for this job; empty uses Pi's default
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

At 03:00 local time, `dream` consolidates chat transcripts into notes and task files, updates `memory/MEMORY.md`, and proposes behaviour changes in `memory/PROPOSALS.md`. Review proposals in a later chat to approve them; dream leaves `AGENTS.md` and skills unchanged. Its instructions are in `prompts/dream.md`.

A failed run leaves `{{last_run}}` unchanged, so the next run covers the same transcripts again.

## Running

The daemon is the one long-lived process: it holds the message queue, fires schedules, closes quiet sessions and starts an agent run for each of them. Every other command is a small client that talks to it, so nothing works while it is stopped.

| Command | What it does |
|---|---|
| `npm run daemon` | start the daemon in the foreground |
| `npm run chat -- "<prompt>"` | send a message and print the answer |
| `npm run status` | list schedules, closed sessions and recent messages |
| `npm run job -- <schedule name>` | run a schedule now |

To keep the daemon running whenever you are logged in, and to chat from any directory, install it as a systemd user service with a `mei` command:

```sh
make install                    # with Nix: nix-shell --run "make install"
mei "hi"
journalctl --user -u mei        # what the daemon printed
```

`make install` runs `npm install`, then writes `~/.config/systemd/user/mei.service` and `~/.local/bin/mei` for this checkout, and starts the service (restarting it if it was already running). The service gets the `PATH` of the shell that ran `make install`, and mei can only use tools found on it. Run `make install` again after moving the checkout or changing where `node` and `pi-bolt` are installed.

`make uninstall` stops the service and removes both files.

The full record of each answer and scheduled run is in `state/logs/`, described below.

## State

Everything the daemon stores is under `state/`: the message history and session summaries in `mei.db`, the conversations in `sessions/chat/`, and the routing decision and full event stream of each answer and scheduled run in `logs/<message number>.jsonl`. Set `MEI_STATE_DIR` to keep it somewhere else.
