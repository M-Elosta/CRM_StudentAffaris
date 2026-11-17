#!/usr/bin/env bash
# Employer Relations CRM — build a release tarball from a git commit.
#
#   bash deploy/make-release.sh [<git-ref>] [<output-directory>]
#
# <git-ref> defaults to HEAD; the output directory to the current directory.
# Only committed files are included (git archive), never local changes,
# node_modules, data or .env files. The name is
# ero-crm-<package.json version>-<short commit>.tar.gz and a .sha256 file is
# written beside it. Deploy it with: bash deploy/deploy.sh <tarball>

set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  local ref="${1:-HEAD}" out_dir="${2:-.}"
  local repo commit short version name tarball
  repo="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run this inside the git repository."
  commit="$(git -C "$repo" rev-parse --verify --quiet "$ref^{commit}")" || die "unknown git ref: $ref"
  short="$(git -C "$repo" rev-parse --short=10 "$commit")"
  version="$(git -C "$repo" show "$commit:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')" ||
    die "cannot read the version from package.json at $ref."
  [[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || die "unexpected version \"$version\"."
  name="ero-crm-$version-$short"
  mkdir -p -- "$out_dir"
  tarball="$(cd "$out_dir" && pwd)/$name.tar.gz"
  [[ ! -e "$tarball" ]] || die "$tarball already exists."
  echo "Building $tarball from $ref ($commit)"
  git -C "$repo" archive --format=tar.gz --prefix="$name/" -o "$tarball" "$commit"
  (cd "$(dirname -- "$tarball")" && sha256sum -- "$(basename -- "$tarball")" >"$(basename -- "$tarball").sha256")
  echo "Done: $tarball"
  echo "Checksum: $tarball.sha256 (check on the server with: sha256sum -c $name.tar.gz.sha256)"
}

main "$@"
