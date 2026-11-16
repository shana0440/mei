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

mei keeps one conversation per task. For every message it decides whether you are continuing an earlier task or starting a new one, and prints the task's topic in brackets before the answer:

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

The topic and the debug output go to stderr, so `npm run -s chat -- "hi" 2>/dev/null` prints the answer alone. Ctrl-C stops waiting; the message is still answered, and `npm run status` shows the result.

## Configuration

`config.toml` holds the settings. Restart the daemon after changing it.

```toml
[chat]
model = "anthropic/claude-haiku-5-5"   # model for chat runs, as provider/id; empty uses Pi's default

[router]
model = "anthropic/claude-haiku-5-5"   # model that decides which session a message belongs to
```

The instructions for that decision are in `prompts/route.md`.

## State

Everything the daemon stores is under `state/`: the message history in `mei.db`, the conversations in `sessions/chat/`, and the routing decision and full event stream of each answer in `logs/<message number>.jsonl`. Set `MEI_STATE_DIR` to keep it somewhere else.
