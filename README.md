# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24.

```sh
npm run daemon
```

With the daemon running, in another terminal:

```sh
npm run event -- user.message --payload '{"text":"hi"}'   # add an event, prints its ID
npm run status                                            # list pending, running and recent events
```

An event type is `user.message`, `session.idle` or `timer.fired`. Pass `--dedupe <key>` to add an event at most once per key.
