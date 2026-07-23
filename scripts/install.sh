#!/usr/bin/env bash
# atelier 원터치 설치 — 앱 + CLI + Claude 스킬
#
# 사용법:
#   curl -fsSL https://github.com/Broco98/atelier/releases/latest/download/install.sh | bash
#
# 멱등: 이미 완료된 단계는 건너뛰고, 중간에 실패해도 다시 실행하면 이어서 진행한다.
# sudo 불필요: 기본 위치에 쓰기 권한이 없으면 사용자 홈 아래로 폴백한다.
set -euo pipefail

REPO="Broco98/atelier"
APP_DIR_PRIMARY="/Applications"
BIN_DIR_PRIMARY="/usr/local/bin"

STEP="시작"
fail() {
  echo "" >&2
  echo "실패: [$STEP] 단계에서 중단됐습니다." >&2
  echo "원인을 해결한 뒤 같은 명령을 다시 실행하면, 완료된 단계는 건너뛰고 이어서 진행합니다." >&2
}
trap fail ERR

# --- 환경 확인 -----------------------------------------------------------
STEP="환경 확인"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "이 스크립트는 Apple Silicon macOS 전용입니다. (감지: $(uname -s)/$(uname -m))" >&2
  exit 1
fi

# --- 최신 버전 확인 ------------------------------------------------------
STEP="최신 버전 확인"
LATEST_URL="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
TAG="${LATEST_URL##*/}"
VERSION="${TAG#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "최신 릴리스 태그를 확인하지 못했습니다: $LATEST_URL" >&2
  exit 1
fi
DOWNLOAD="https://github.com/$REPO/releases/download/$TAG"
APP_ASSET="atelier-app-${VERSION}-aarch64-apple-darwin.tar.gz"
CLI_ASSET="atelier-cli-${VERSION}-aarch64-apple-darwin.tar.gz"
echo "대상 버전: v$VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1/4 앱 설치 ---------------------------------------------------------
STEP="앱 설치"
if [[ -w "$APP_DIR_PRIMARY" ]]; then
  APP_DIR="$APP_DIR_PRIMARY"
else
  APP_DIR="$HOME/Applications"
  mkdir -p "$APP_DIR"
fi
APP="$APP_DIR/atelier.app"
installed_app_version() {
  defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true
}
if [[ "$(installed_app_version)" == "$VERSION" ]]; then
  echo "[1/4] 앱: v$VERSION 이미 설치됨 — 건너뜀 ($APP)"
else
  echo "[1/4] 앱: v$VERSION 다운로드·설치 중… ($APP)"
  curl -fL --retry 3 -o "$TMP/$APP_ASSET" "$DOWNLOAD/$APP_ASSET"
  tar -xzf "$TMP/$APP_ASSET" -C "$TMP"
  rm -rf "$APP"
  ditto "$TMP/atelier.app" "$APP"
  echo "[1/4] 앱: 설치 완료"
fi

# --- 2/4 Gatekeeper 격리 해제 --------------------------------------------
# 우리 릴리스에서 받아 방금 배치한 고정 경로($APP)에만 적용한다.
STEP="격리 해제"
xattr -cr "$APP"
echo "[2/4] 격리 해제(xattr -cr) 완료"

# --- 3/4 CLI 설치 --------------------------------------------------------
STEP="CLI 설치"
if [[ -d "$BIN_DIR_PRIMARY" && -w "$BIN_DIR_PRIMARY" ]]; then
  BIN_DIR="$BIN_DIR_PRIMARY"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi
CLI="$BIN_DIR/atelier"
installed_cli_version() {
  "$CLI" --version 2>/dev/null | awk '{print $2}' || true
}
if [[ -x "$CLI" && "$(installed_cli_version)" == "$VERSION" ]]; then
  echo "[3/4] CLI: v$VERSION 이미 설치됨 — 건너뜀 ($CLI)"
else
  echo "[3/4] CLI: v$VERSION 다운로드·설치 중… ($CLI)"
  curl -fL --retry 3 -o "$TMP/$CLI_ASSET" "$DOWNLOAD/$CLI_ASSET"
  tar -xzf "$TMP/$CLI_ASSET" -C "$TMP"
  install -m 755 "$TMP/atelier" "$CLI"
  echo "[3/4] CLI: 설치 완료"
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "      주의: $BIN_DIR 이 PATH에 없습니다. 셸 설정에 추가하세요:"
    echo "        echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
    ;;
esac

# --- 4/4 Claude 스킬 설치 ------------------------------------------------
STEP="스킬 설치"
"$CLI" skill install
echo "[4/4] 스킬 설치 완료"

echo ""
echo "완료 — 앱: $APP · CLI: $CLI (v$VERSION) · 스킬: ~/.claude/skills/atelier"
