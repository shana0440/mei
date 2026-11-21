# mei

A personal assistant.

## Code

- This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
- Prefer deleting code over adding it. The best code is code that does not need to exist.
- Let the code explain itself; rename or restructure where you would write a comment.
- Give every value a real type; treat `any` as a last resort.

## Documents

Every document here, this file included, is for someone new to the repo. Keep only what helps them understand or use it.

## Verify

- Don't write unit tests.
- Check a change the way a user would.
- When the check is done, clean up every file the check created.

## Commits

- Before you start, list the steps of the change; each step is one concern and one commit.
- Commit a step as soon as it works and is checked, before starting the next. Don't build a whole feature and split it afterwards.
- If the message needs "and", or a body that lists several changes, the commit holds more than one concern: split it.
- The message is one imperative sentence that says what the commit adds or changes, in the style of conventional commits. Add a body only when the reason is not obvious from the diff.
- A fix to something an earlier step built gets its own commit, before the commits of the current step.
