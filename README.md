# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24 and a model provider signed in through [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt). mei runs the agent with the Pi SDK and shares Pi-Bolt's settings, extensions and credentials.

```sh
npm install
npm run daemon
```

With the daemon running, in another terminal:

```sh
npm run chat -- "hi"   # send mei a message and print its answer
npm run status         # list pending, running and recent messages
```

Messages are answered one at a time, oldest first. Each message starts a new conversation; mei does not yet remember earlier ones.

## Configuration

`config.toml` holds the settings. Restart the daemon after changing it.

```toml
[chat]
model = "anthropic/claude-haiku-5-5"   # model for chat runs, as provider/id; empty uses Pi's default
```

## State

Everything the daemon stores is under `state/`: the message history in `mei.db`, the conversations in `sessions/chat/`, and the full event stream of each answer in `logs/<message number>.jsonl`. Set `MEI_STATE_DIR` to keep it somewhere else.
