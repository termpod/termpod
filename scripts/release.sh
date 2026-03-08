#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.1.7

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.1.7"
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in semver format (e.g., 0.1.7)"
  exit 1
fi

# Check for clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

echo "Bumping version to $VERSION..."

# JSON files — update "version": "..."
for file in \
  package.json \
  apps/desktop/package.json \
  apps/desktop/src-tauri/tauri.conf.json \
  packages/protocol/package.json \
  packages/shared/package.json \
  packages/ui/package.json \
  relay/package.json; do
  sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$VERSION\"/" "$file"
  echo "  Updated $file"
done

# Cargo.toml — update version = "..."
sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" apps/desktop/src-tauri/Cargo.toml
echo "  Updated apps/desktop/src-tauri/Cargo.toml"

# Update Cargo.lock
(cd apps/desktop/src-tauri && cargo generate-lockfile 2>/dev/null || true)

echo ""
echo "Committing, tagging, and pushing..."

git add -A
git commit -m "Bump version to $VERSION"
git tag "v$VERSION"
git push
git push --tags

echo ""
echo "Released v$VERSION"
