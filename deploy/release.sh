#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./deploy/release.sh <X.Y.Z>

Create an annotated release tag vX.Y.Z on master and push it to origin.
Pushing the tag triggers the production deploy workflow.

Fallback (what this script does):
  git fetch origin
  git tag -a vX.Y.Z -m "Release vX.Y.Z" master
  git push origin vX.Y.Z
USAGE
}

fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

VERSION="${1:-}"
[[ -n "$VERSION" ]] || { usage; fail "Missing version argument."; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$VERSION' is not strict semver (expected X.Y.Z, no 'v' prefix, no pre-release suffix)."
TAG="v${VERSION}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not inside a git work tree."

branch="$(git branch --show-current)"
[[ "$branch" == "master" ]] || fail "Releases must be cut from 'master' (currently on '${branch:-detached HEAD}')."

[[ -z "$(git status --porcelain)" ]] || fail "Working tree has uncommitted changes. Commit or stash them first."

git fetch origin --tags --quiet

local_head="$(git rev-parse master)"
remote_head="$(git rev-parse origin/master)"
[[ "$local_head" == "$remote_head" ]] || fail "Local master is not up to date with origin/master. Pull/rebase and push first."

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  fail "Tag ${TAG} already exists. Did you mean the next version? Latest: $(git describe --tags --abbrev=0 2>/dev/null || echo none)"
fi

git tag -a "$TAG" -m "Release ${TAG}"
git push origin "$TAG"
printf 'Released %s — the deploy workflow is now running.\n' "$TAG"
