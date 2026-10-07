#!/usr/bin/env bash
# Build a scrubbed public mirror of this repo with a single fresh commit.
#
#   scripts/public-mirror.sh [out-dir] [remote-url]
#
# - Exports the committed tree at HEAD (uncommitted/ignored files never leak).
# - Drops paths listed in MIRROR_EXCLUDE below.
# - Replaces the KV namespace IDs in wrangler.jsonc with placeholders.
# - Refuses to finish if anything that looks like a secret survives.
# - Creates a brand-new git history (one commit), so none of the private
#   repo's commits, authors or old file versions go public.
# - If remote-url is given, force-pushes that commit to its `main` branch.
#
# Override the mirror commit author with MIRROR_AUTHOR_NAME / MIRROR_AUTHOR_EMAIL.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
OUT="${1:-$ROOT/../cf-browser-mcp-public}"
REMOTE="${2:-}"
AUTHOR_NAME="${MIRROR_AUTHOR_NAME:-leied}"
AUTHOR_EMAIL="${MIRROR_AUTHOR_EMAIL:-149900992+leied@users.noreply.github.com}"

# Paths that stay private (relative to the repo root).
MIRROR_EXCLUDE=(
  scripts/public-mirror.sh
  .github/workflows/public-mirror.yml
)

if [[ -e "$OUT" ]]; then
  echo "error: $OUT already exists; remove it or pass another out-dir" >&2
  exit 1
fi

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "warning: uncommitted changes are NOT included (mirror uses HEAD)" >&2
fi

mkdir -p "$OUT"
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$OUT"

for path in "${MIRROR_EXCLUDE[@]}"; do
  rm -rf "${OUT:?}/$path"
done
# Remove directories the excludes left empty.
find "$OUT" -mindepth 1 -type d -empty -delete

# Scrub KV namespace IDs (32 hex chars) in wrangler.jsonc.
sed -i -E \
  -e 's/("id": *")[0-9a-f]{32}"/\1REPLACE_WITH_KV_NAMESPACE_ID"/' \
  -e 's/("preview_id": *")[0-9a-f]{32}"/\1REPLACE_WITH_KV_PREVIEW_ID"/' \
  "$OUT/wrangler.jsonc"

# Last-line check: anything secret-shaped left in the tree?
if grep -rInE \
  --exclude=package-lock.json \
  -e '"(id|preview_id)": *"[0-9a-f]{32}"' \
  -e 'Bearer [A-Za-z0-9._-]{20,}' \
  -e 'Basic [A-Za-z0-9+/=]{20,}' \
  -e '(ghp|gho|github_pat|sk|hf)_[A-Za-z0-9_]{20,}' \
  "$OUT"; then
  echo "error: possible secret above; mirror left at $OUT for inspection" >&2
  exit 1
fi

git -C "$OUT" init -q -b main
git -C "$OUT" add -A
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$OUT" commit -q -m "Public release ($(git -C "$ROOT" rev-parse --short HEAD))"

echo "mirror built at $OUT"

if [[ -n "$REMOTE" ]]; then
  git -C "$OUT" remote add origin "$REMOTE"
  git -C "$OUT" push --force -u origin main
fi
