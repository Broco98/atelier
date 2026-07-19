#!/usr/bin/env bash
# 사용법: scripts/bump-version.sh 0.2.0
# package.json, tauri.conf.json, Cargo.toml ×3, Cargo.lock을 갱신하고
# "release: v<버전>" 커밋과 v<버전> 태그를 만든다. push는 하지 않는다.
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "사용법: $0 <major.minor.patch>  예) $0 0.2.0" >&2
  exit 1
fi
NEW="$1"

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "작업 트리가 깨끗하지 않습니다. 커밋하거나 정리한 뒤 다시 실행하세요." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then
  echo "태그 v$NEW 가 이미 존재합니다." >&2
  exit 1
fi

for f in package.json src-tauri/tauri.conf.json; do
  sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$NEW\"/" "$f"
done
for f in crates/atelier-core/Cargo.toml crates/atelier-cli/Cargo.toml src-tauri/Cargo.toml; do
  sed -i '' "s/^version = \"[0-9.]*\"/version = \"$NEW\"/" "$f"
done
cargo update --workspace --quiet

git add package.json src-tauri/tauri.conf.json \
  crates/atelier-core/Cargo.toml crates/atelier-cli/Cargo.toml \
  src-tauri/Cargo.toml Cargo.lock
git commit -q -m "release: v$NEW"
git tag "v$NEW"

echo "완료: v$NEW 커밋 + 태그 생성"
echo "릴리스하려면 main에서 실행했는지 확인 후:"
echo "  git push origin HEAD --follow-tags"
