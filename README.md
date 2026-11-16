# mei

mei is a personal assistant that runs as a daemon on your machine.

## Usage

Requires Node 24.

```sh
npm run daemon
```

With the daemon running, in another terminal:

```sh
npm run chat -- "hi"   # send mei a message
npm run status         # list pending, running and recent messages
```

mei keeps every message but does not answer yet.
