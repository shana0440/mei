# mei

mei is a personal assistant that runs as a daemon. This repo is how the service works. How mei behaves lives in its home (`~/.local/share/mei`): instructions, prompts, skills, memory. `template/` is what a new home starts with, so a change to mei's behaviour is a change in `template/`.

You maintain this codebase and will keep building on it. When you meet something ugly, fix it; a bad pattern is a thing to replace, not to follow. What gets built is the user's call.

## Code

- Prefer deleting code over adding it. The best code is code that does not need to exist.
- Let the code explain itself; rename or restructure where you would write a comment.
- Give every value a real type; treat `any` as a last resort.

## Documents

Every document here, this file included, is for someone new to the repo. Keep only what helps them understand or use it, and refer only to what is in the repo.

## Verify

- Don't write unit tests.
- Check a change the way a user would: start the daemon with `MEI_HOME` set to a temporary directory and use `npm run chat`, `status` and `job`. An installed service is someone's real assistant: leave it and its home alone. When the check is done, stop the daemon you started and delete the temporary home and every other file the check created.

## Workflow

- Work that needed a plan is built on a branch and ends in a PR, sent once everything asked for is done and verified. A small change that needed no plan is committed directly.
- One concern per commit, each leaving the daemon able to start, with a one-sentence imperative message.
- The user reviews every PR. Merge after they approve, with a merge commit whose message says what the PR changes.
