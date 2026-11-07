#!/bin/sh
# Prints what is live, what is on test, what is waiting to go live, and the latest deploy runs.
# Read-only: fetches from origin and queries GitHub, never deploys.
set -eu

git fetch --quiet --tags origin

prod_tag=$(git tag -l 'prod-*' --sort=-creatordate | head -n 1)
main_sha=$(git rev-parse --short origin/main)

echo "== Live (/dyp)"
if [ -n "$prod_tag" ]; then
  echo "$prod_tag -> $(git log -1 --format='%h %s (%cs)' "$prod_tag")"
else
  echo "no prod-* tag yet: nothing has been deployed by deploy.yml"
fi

echo
echo "== main"
git log -1 --format='%h %s (%cs)' origin/main

if [ -n "$prod_tag" ]; then
  pending=$(git log --oneline "$prod_tag..origin/main")
  echo
  echo "== On main but not live"
  if [ -n "$pending" ]; then echo "$pending"; else echo "(none: live is up to date with main)"; fi
fi

echo
echo "== Recent prod tags (rollback targets)"
git tag -l 'prod-*' --sort=-creatordate | head -n 5 | while read -r t; do
  echo "$t -> $(git log -1 --format='%h %s' "$t")"
done

echo
echo "== Latest test deploys (ci.yml on main)"
gh run list --workflow ci.yml --branch main --event push -L 3 \
  --json headSha,conclusion,status,createdAt,url \
  --jq '.[] | "\(.headSha[0:7]) \(.status)/\(.conclusion // "-") \(.createdAt) \(.url)"'

echo
echo "== Latest production deploys (deploy.yml)"
gh run list --workflow deploy.yml -L 3 \
  --json headSha,conclusion,status,createdAt,url,actor \
  --jq '.[] | "\(.status)/\(.conclusion // "-") \(.createdAt) by \(.actor.login) \(.url)"' 2>/dev/null \
  || echo "(deploy.yml is not on main yet)"

echo
echo "(origin/main is $main_sha)"
