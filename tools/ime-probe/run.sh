#!/bin/sh
# 한글이 셸에 온전히 닿는지 잰다. **GUI 세션에서 손으로 돌린다** — 창을 앞으로 끌어오고
# 입력 소스를 두벌식으로 바꿨다 되돌리므로 CI에 걸 수 없다.
#
#   sh tools/ime-probe/run.sh
#
# 두벌식 입력 소스가 켜져 있어야 하고(시스템 설정 ▸ 키보드 ▸ 입력 소스), 터미널 앱에
# 손쉬운 사용 권한이 있어야 한다(키 이벤트를 던진다).
set -e
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

cp node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/xterm/css/xterm.css "$OUT/"
ESB=$(ls node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | head -1)
"$ESB" src/features/terminal/terminal-ime.ts --bundle --format=iife \
  --global-name=AtelierIme --log-level=error > "$OUT/terminal-ime.js"
# 규칙을 손으로 다시 적지 않는다 — 앱이 쓰는 그것을 그대로 떠 온다.
awk '/^\.xterm textarea\.xterm-helper-textarea/,/^}/' src/index.css > "$OUT/app.css"
test -s "$OUT/app.css" || { echo "index.css에서 숨은 입력칸 규칙을 못 찾았다"; exit 1; }
sed -e "/__APP_CSS__/r $OUT/app.css" tools/ime-probe/page.html > "$OUT/page.html"
swiftc -swift-version 5 -O tools/ime-probe/probe.swift -o "$OUT/probe" 2>/dev/null

fail=0
# **글자가 아니라 코드포인트로 잰다.** 개행(000D)도 U+00A0도 눈에 안 보이는데, 이 판이
# 고친 것 중 하나가 바로 「스페이스가 U+00A0으로 오던 것」이다. 보이는 것으로 비교하면
# 그 회귀가 조용히 통과한다.
check() { # 이름 키코드 기대코드포인트 [ascii]
  got=$("$OUT/probe" "$OUT/page.html" "$2" "$4" 2>/dev/null | sed -n 's/^FINAL →PTY 합계 = ".*" \[\(.*\)\]$/\1/p')
  if [ "$got" = "$3" ]; then printf '  ok    %-24s %s\n' "$1" "$got"
  else printf '  FAIL  %-24s %s\n        %-24s %s (기대)\n' "$1" "$got" "" "$3"; fail=1; fi
}
echo "한글 조합 계측 — 창이 앞으로 나오고 입력 소스가 잠깐 바뀝니다"
check "안녕 + space"  "2,40,1,1,32,2,49"       "C548 B155 0020"
check "안녕 + Enter"  "2,40,1,1,32,2,36"       "C548 B155 000D"
check "안녕 + BS 2회" "2,40,1,1,32,2,51,51,36" "C548 3134 000D"
check "영문 hello"    "4,14,37,37,31,36"       "0068 0065 006C 006C 006F 000D" ascii
exit $fail
