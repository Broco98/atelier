#!/usr/bin/env bash
# 사용법: scripts/bump-version.sh 0.2.0
# package.json, tauri.conf.json, 워크스페이스 크레이트 전부의 Cargo.toml, Cargo.lock을
# 갱신하고 "release: v<버전>" 커밋과 v<버전> 태그를 만든다. push는 하지 않는다.
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

# 크레이트 목록을 여기에 손으로 적지 않는다. 예전엔 셋을 적어 뒀는데 네 번째 크레이트
# (atelier-test-bridge)가 들어오자 그 목록이 조용히 낡아, v0.7.0을 자른 뒤에도 그것만
# 0.6.1로 남았다. 워크스페이스에 무엇이 있는지는 cargo가 정본이므로 거기서 받는다.
# 갈라지면 src/release-version.test.ts가 빨간불을 켠다.
MANIFESTS=$(cargo metadata --no-deps --format-version 1 \
  | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).packages.map(p=>p.manifest_path).join('\n')")
if [[ -z "$MANIFESTS" ]]; then
  echo "cargo metadata에서 워크스페이스 크레이트를 하나도 받지 못했습니다." >&2
  exit 1
fi

for f in package.json src-tauri/tauri.conf.json; do
  sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$NEW\"/" "$f"
done
while IFS= read -r f; do
  sed -i '' "s/^version = \"[0-9.]*\"/version = \"$NEW\"/" "$f"
done <<< "$MANIFESTS"
cargo update --workspace --quiet

git add package.json src-tauri/tauri.conf.json Cargo.lock
while IFS= read -r f; do
  git add "$f"
done <<< "$MANIFESTS"
git commit -q -m "release: v$NEW"
git tag "v$NEW"

echo "완료: v$NEW 커밋 + 태그 생성"
echo "릴리스하려면 main에서 실행했는지 확인 후:"
echo "  git push origin HEAD --follow-tags"
