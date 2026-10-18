#!/bin/zsh
# Fetches Chennai lake and reservoir levels from this machine (the Tamil Nadu government sites
# block GitHub's servers) and uploads them to the repo as data/lakes.json, which redeploys the site.
# Runs from launchd; see scripts/com.tnrainwatch.lakes.plist.
set -euo pipefail

export PATH="$HOME/.local/node-current/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO=fleximarketer-pixel/chennai-weather
GH_USER=fleximarketer-pixel

cd "$(dirname "$0")/.."
tmp=$(mktemp -t tn-lakes)
trap 'rm -f "$tmp"' EXIT

echo "$(date '+%F %T') fetching"
node scripts/update-data.mjs --only lakes,dams --out "$tmp"

export GH_TOKEN=$(gh auth token -u "$GH_USER")
sha=$(gh api "repos/$REPO/contents/data/lakes.json" --jq .sha 2>/dev/null || true)
gh api -X PUT "repos/$REPO/contents/data/lakes.json" \
  -f message="Update lake and reservoir levels" \
  -f content="$(base64 -i "$tmp")" \
  ${sha:+-f sha="$sha"} --jq .commit.sha
echo "$(date '+%F %T') pushed"
