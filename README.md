# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24 and [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) (`pi-bolt` on your PATH, signed in to a model provider).

```sh
npm install
npm run daemon
```

With the daemon running, in another terminal:

```sh
npm run chat -- "hi"            # send mei a message and print its answer
npm run chat -- --debug "hi"    # also show where the message went and the work as it happens
npm run status                  # list pending, running and recent messages
```

Messages are answered one at a time, oldest first.

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

A session stays open for 30 minutes after its last message (`[idle] after_minutes`). After that a message on the same subject starts a new session, which does not see the old conversation. This keeps sessions short, so a message never pays to reload a long conversation whose prompt cache has expired.

The topic and the debug output go to stderr, so `npm run -s chat -- "hi" 2>/dev/null` prints the answer alone. Ctrl-C stops waiting; the message is still answered, and `npm run status` shows the result.

## Configuration

`config.toml` holds the settings. Restart the daemon after changing it.

```toml
[chat]
model = "anthropic/claude-haiku-5-5"   # model for chat runs, as provider/id; empty uses Pi's default

[router]
model = "anthropic/claude-haiku-5-5"   # model that decides which session a message belongs to

[idle]
after_minutes = 30       # a session this quiet is closed; a later message starts a new session
```

The instructions for that decision are in `prompts/route.md`.

## State

Everything the daemon stores is under `state/`: the message history in `mei.db`, the conversations in `sessions/chat/`, and the routing decision and full event stream of each answer in `logs/<message number>.jsonl`. Set `MEI_STATE_DIR` to keep it somewhere else.
