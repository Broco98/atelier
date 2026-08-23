#!/bin/sh
# 한글이 셸에 온전히 닿는지 잰다. **GUI 세션에서 손으로 돌린다** — 창을 앞으로 끌어오고
# 입력 소스를 바꿨다 되돌리므로 CI에 걸 수 없다.
#
#   sh tools/ime-probe/run.sh
#
# 두벌식과 ABC 입력 소스가 켜져 있어야 하고(시스템 설정 ▸ 키보드 ▸ 입력 소스), 터미널 앱에
# 손쉬운 사용 권한이 있어야 한다(키 이벤트를 던진다).
set -e
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
die() { echo "!! $1" >&2; exit 1; }

cp node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/xterm/css/xterm.css "$OUT/" \
  || die "xterm이 설치돼 있지 않다 — pnpm install 먼저"

ESB=$(ls node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1)
[ -x "$ESB" ] || die "esbuild를 못 찾았다 (node_modules/.pnpm/esbuild@*/…) — pnpm install 먼저"
"$ESB" tools/ime-probe/entry.ts --bundle --format=iife --global-name=Atelier \
  --log-level=warning > "$OUT/app.js" || die "앱 모듈 번들에 실패했다"
[ -s "$OUT/app.js" ] || die "번들이 비었다"

# 규칙을 손으로 다시 적지 않는다 — 앱이 쓰는 그것을 그대로 떠 온다.
awk '/^\.xterm textarea\.xterm-helper-textarea/,/^}/' src/index.css > "$OUT/app.css"
grep -q 'min-width' "$OUT/app.css" \
  || die "index.css에서 숨은 입력칸의 크기 바닥 규칙을 못 찾았다 (선택자나 속성이 바뀌었나)"
sed -e "/__APP_CSS__/r $OUT/app.css" tools/ime-probe/page.html > "$OUT/page.html"

swiftc -swift-version 5 -O tools/ime-probe/probe.swift -o "$OUT/probe" \
  || die "probe.swift 빌드에 실패했다"

fail=0
# **글자가 아니라 코드포인트로 잰다.** 개행(000D)도 U+00A0도 눈에 안 보이는데, 이 판이
# 고친 것 중 하나가 바로 「스페이스가 U+00A0으로 오던 것」이다. 보이는 것으로 비교하면
# 그 회귀가 조용히 통과한다.
check() { # 이름 키코드 기대코드포인트 [추가인자…]
  name=$1; keys=$2; want=$3; shift 3
  raw=$("$OUT/probe" "$OUT/page.html" "$keys" "$@" 2>&1) || true
  got=$(printf '%s\n' "$raw" | sed -n 's/^FINAL →PTY 합계 = ".*" \[\(.*\)\]$/\1/p')
  if [ -z "$got" ]; then
    printf '  ERR   %-24s 계측이 결과를 못 냈다\n' "$name"
    printf '%s\n' "$raw" | sed 's/^/          /'
    fail=1
  elif [ "$got" = "$want" ]; then
    printf '  ok    %-24s %s\n' "$name" "$got"
  else
    printf '  FAIL  %-24s %s\n        %-24s %s (기대)\n' "$name" "$got" "" "$want"
    fail=1
  fi
}
echo "한글 조합 계측 — 창이 앞으로 나오고 입력 소스가 잠깐 바뀝니다"
check "안녕 + space"   "2,40,1,1,32,2,49"       "C548 B155 0020"
check "안녕 + Enter"   "2,40,1,1,32,2,36"       "C548 B155 000D"
check "안녕 + BS 2회"  "2,40,1,1,32,2,51,51,36" "C548 3134 000D"
# Shift가 음절 **한가운데** 들어오는 자리. 안 막으면 앞 음절이 두 번 나간다(「해했다」).
check "했다 (Shift)"   "5,31,s17,14,40,36"      "D588 B2E4 000D"
# 커서가 넓은 글자 뒤칸이면 xterm이 인라인 `width: 0px`을 쓴다 — 크기 바닥이 그걸 막는다.
check "안녕 (0폭 칸)"  "2,40,1,1,32,2,36"       "C548 B155 000D" wide
check "영문 hello"     "4,14,37,37,31,36"       "0068 0065 006C 006C 006F 000D" ascii

# 붙들고 있는 동안 그 글자는 셸에 없다 — 커서 자리에 겹쳐 보여 주지 않으면 한 박자 늦게 보인다.
view() { # 이름 키코드 기대VIEW줄
  raw=$("$OUT/probe" "$OUT/page.html" "$2" 2>&1) || true
  got=$(printf '%s\n' "$raw" | sed -n 's/^VIEW //p')
  if [ "$got" = "$3" ]; then printf '  ok    %-24s %s\n' "$1" "$got"
  else printf '  FAIL  %-24s %s\n        %-24s %s (기대)\n' "$1" "$got" "" "$3"; fail=1; fi
}
view "조합 표시 (안녕)" "2,40,1,1,32,2"    'active=true text="녕" 자리맞음=true'
view "조합 표시 (끝난 뒤)" "2,40,1,1,32,2,36" 'active=false text="" 자리맞음=true'
exit $fail
