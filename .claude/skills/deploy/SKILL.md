---
name: deploy
description: >-
  Deploy Foos Tourney to the club site with the GitHub Actions workflows, using gh. Covers the
  automatic test deploy to calgaryfoosballclub.com/dyp/tst after a merge to main, the manual
  production deploy of a tag or commit to /dyp, rollbacks to an earlier prod- tag, checking what is
  live, reading a failed deploy, and changing who may deploy. Use it whenever the user says deploy,
  release, ship, publish to the club site, push live, go to prod, roll back, "what's live", or asks
  about a deploy run or the tst folder, even if they don't name the workflow.
allowed-tools:
  - Bash(.claude/skills/deploy/scripts/deploy-status.sh:*)
  - Bash(git fetch:*)
  - Bash(git log:*)
  - Bash(git rev-parse:*)
  - Bash(git merge-base:*)
  - Bash(git tag -l:*)
  - Bash(git show:*)
  - Bash(gh run list:*)
  - Bash(gh run view:*)
  - Bash(gh run watch:*)
  - Bash(gh pr checks:*)
  - Bash(gh pr view:*)
  - Bash(gh variable list:*)
  - Bash(gh workflow view:*)
  - Bash(curl -fsS https://calgaryfoosballclub.com/dyp/:*)
---

# Deploying Foos Tourney

Two GitHub Actions workflows deploy the build's `dist/` to the club host over FTPS. Claude's job is to
drive them with `gh`, confirm with the user before anything goes live, and report what happened. Never
upload by hand with `lftp` or `lftp.sh` unless the user explicitly asks for a manual fallback: the
workflows pin the host certificate, upload `index.html` last (so no browser caches an old script under a
new `?v=` stamp for 31 days), verify every file over HTTPS and tag the release. A hand upload skips all of
that.

| Target | Folder on host         | Public URL                               | How it runs                                                                     |
| ------ | ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Test   | `/public_html/dyp/tst` | https://calgaryfoosballclub.com/dyp/tst/ | `deploy-test` job in `ci.yml`, after every push to `main` that passes the build |
| Live   | `/public_html/dyp`     | https://calgaryfoosballclub.com/dyp/     | `deploy.yml`, dispatched by hand with a `ref`                                   |

Details of the workflows live in `.github/workflows/` and the README's **Deploying** section. Read them
if something here seems out of date, and trust the files over this skill.

## Start with the status

Run the bundled script first for any deploy request. It fetches tags and prints what is live, what is on
test, what is waiting, and the latest runs:

```sh
.claude/skills/deploy/scripts/deploy-status.sh
```

Use it to answer "what's live?" questions directly, and to show the user what a deploy would change.

## Test deploy

There is nothing to trigger: merging a PR into `main` deploys to test once CI passes. When the user wants
something on test:

1. If it isn't merged yet, check the PR with `gh pr checks <n>`. Merging is the user's call. Offer
   `gh pr merge <n>`, and run it only when they say so (it is outward-facing and starts a deploy).
2. Find the push run: `gh run list --workflow ci.yml --branch main --event push -L 3`.
3. Wait for it (see "Waiting on a run") and report the `deploy-test` job's result and the test URL.

Pull requests show `deploy-test` as skipped. That is expected.

## Production deploy

1. **Pick the ref.** The user gives a tag or commit id (short or full). With no ref, the default is the
   latest `main`; say so. Resolve and check it locally so mistakes surface before a 20-minute build:
   ```sh
   git fetch --quiet --tags origin
   sha=$(git rev-parse --verify --quiet "<ref>^{commit}")       # fails on unknown or ambiguous ids
   git merge-base --is-ancestor "$sha" origin/main && echo on-main
   ```
   The workflow refuses refs that aren't on `main`, so stop and tell the user rather than dispatching.
2. **Show what changes.** From the status script's current `prod-` tag, list the commits going live:
   `git log --oneline <current-prod-tag>..<sha>`. For a rollback the range is reversed. Say that it
   removes those commits from live.
3. **Confirm.** Production is public. Tell the user the exact commit (short id and subject) and wait for a
   clear yes in this conversation, even if they asked for the deploy in the same message. An earlier
   approval doesn't carry over to a different ref.
4. **Dispatch** from `main`, always. Both environments only accept runs from `main`, and the workflow
   fails fast otherwise:
   ```sh
   gh workflow run deploy.yml --ref main -f ref=<ref>
   ```
   gh doesn't print the run id. Find it a few seconds later, and check its `createdAt` is after the
   dispatch so you don't watch an older run:
   ```sh
   gh run list --workflow deploy.yml --event workflow_dispatch -L 1 --json databaseId,createdAt,status,url
   ```
5. **Wait** for the run (below), then report: the `prod-…` tag it created (`git fetch --tags` and the
   status script), the live URL, and the run URL.

### Rollback

A rollback is a production deploy of an earlier `prod-…` tag: pick it from `git tag -l 'prod-*'`
(the status script lists recent ones) and follow the steps above. It creates a new `prod-` tag on that old
commit, which keeps the history honest. The old commit's own build runs, so it must still pass.

## Waiting on a run

The build takes about 20 minutes, longer than one foreground command may run. Start the watch in the
background so you are notified when it ends, and don't poll in between:

```sh
gh run watch <run-id> --exit-status --interval 60 > /dev/null; gh run view <run-id> --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

## When a deploy fails

Read the failure before guessing: `gh run view <run-id> --log-failed | tail -60`. Common causes:

| Failing job / step       | Meaning and what to do                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorize`, not main    | Dispatched from a branch or tag. Re-run with `--ref main` and the target in `-f ref=`.                                                                                                                                  |
| `authorize`, role        | The person's role is below `DEPLOY_MIN_ROLE`. Only an admin can change that (see below).                                                                                                                                |
| `build`, Resolve ref     | Unknown, ambiguous or off-`main` ref. Use a longer id or a commit on `main`.                                                                                                                                            |
| `build`, `npm run build` | That commit doesn't pass its own quality gates. Fix forward on `main`, or pick another ref.                                                                                                                             |
| `upload`, Upload         | FTPS login or certificate. A certificate error means the host's certificate changed: follow the check in the comment in `ftp-upload.yml` and ask the user before changing the fingerprint. Never turn verification off. |
| `upload`, Verify         | A file read back over HTTPS doesn't match. Re-run once (a cache can lag). If it still fails, report the file names.                                                                                                     |
| `tag`                    | Deployed but untagged. Tell the user. The site is live with that commit.                                                                                                                                                |

A run that fails before `upload` changed nothing on the host. Say so: it is the first thing people want
to know.

## Who can deploy

The `authorize` job allows the role in the repository variable `DEPLOY_MIN_ROLE`: `admin` (default when
unset), `maintain` or `write`. Check it with `gh variable list`. Changing it
(`gh variable set DEPLOY_MIN_ROLE --body write`) is an admin decision: do it only when the user asks.
The real fence is that the `test` and `production` environments accept runs only from `main`, which
needs a reviewed PR. Don't change environment settings or secrets unless asked, and never print or
fetch the FTP secrets.

## Reporting

End with a short summary: what was deployed (short id, subject, tag), where (URL), and whether it was
verified. If nothing was deployed, say why and what changed on the host (usually nothing).
