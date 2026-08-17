# atelier

로컬 프로젝트·작업(Work) 데이터를 관리하는 macOS 데스크톱 앱 + AI용 MCP 서버.
**사람은 앱을 쓰고, AI는 MCP 도구를 씁니다.**
데이터는 `~/.atelier/`에 저장되며, 앱과 MCP 서버가 `atelier-core`를 통해 같은 데이터를 읽고 씁니다.

## 설치 (릴리스)

macOS Apple Silicon 전용. 한 줄로 앱 + Gatekeeper 해제 + `atelier` 바이너리 + MCP 서버 등록까지 끝납니다 (멱등 — 실패 시 재실행하면 이어서 진행):

```sh
curl -fsSL https://github.com/Broco98/atelier/releases/latest/download/install.sh | bash
```

<details>
<summary>수동 설치</summary>

[Releases](https://github.com/Broco98/atelier/releases)에서 다운로드.

**앱** — dmg를 열어 `atelier.app`을 Applications로 복사. 미서명 앱이라 Gatekeeper 해제가 한 번 필요:

```sh
xattr -cr /Applications/atelier.app
```

**바이너리** — 압축을 풀어 PATH에 놓고 MCP 서버를 등록:

```sh
tar -xzf atelier-cli-*.tar.gz
sudo mv atelier /usr/local/bin/
atelier mcp install
```

</details>

## AI 인터페이스 (MCP)

`atelier` 바이너리는 사람용 명령을 갖지 않습니다. 명령은 둘뿐입니다:

```bash
atelier mcp            # 표준입출력 MCP 서버 실행 — 호스트가 서브프로세스로 띄웁니다
atelier mcp install    # 호스트에 이 서버를 사용자 전역으로 등록 (+ 남은 스킬 폴더 정리)
```

등록되면 AI가 도구 9개로 Atelier를 조작합니다 — 프로젝트 조회·등록·수정,
작업 조회·시작·프로젝트 추가·상태 변경·제거. 사용법(개념·브랜치 컨벤션·spec 규약)은
서버가 지침으로 직접 주입하므로 **별도 스킬 문서를 설치하지 않습니다.**

**프로젝트 삭제는 앱에서만** 합니다. 사람이 하는 조작은 전부 앱이 담당합니다.

<details>
<summary>Claude Code 외 호스트에 직접 등록하기</summary>

`atelier mcp install`이 자동 등록하는 호스트는 Claude Code 하나입니다.
다른 호스트는 stdio 서버로 아래를 등록하세요 — 실행 명령 `atelier`, 인자 `["mcp"]`.

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.atelier]
command = "/usr/local/bin/atelier"
args = ["mcp"]
```

```json
// Gemini CLI — ~/.gemini/settings.json
{ "mcpServers": { "atelier": { "command": "/usr/local/bin/atelier", "args": ["mcp"] } } }
```

</details>

## Development

- 앱: `pnpm tauri dev`
- 검증: `pnpm verify` — 타입·Rust·프론트엔드·브라우저를 한 번에. `--full`은 느린 관통 층까지 돌리는 기어이며, 그 층은 아직 없습니다
- 브라우저 층 준비(최초 1회): `pnpm exec playwright install webkit`
- 실패 증거: 브라우저 층이 실패하면 `test-results/<테스트>/` 아래에 스크린샷·콘솔·DOM·실패 지점이 남습니다. 실행마다 통째로 비워지며, 통과한 실행은 증거를 남기지 않습니다(실행 기록 `.last-run.json`만 남습니다)
- CLI 로컬 설치: `cargo install --path crates/atelier-cli`

## Release

main에서 버전을 올리고 태그를 push하면 GitHub Actions가 dmg·앱 tar.gz·CLI tar.gz·install.sh를 빌드해 릴리스를 자동 publish합니다.

```sh
scripts/bump-version.sh 0.2.0   # 매니페스트 5곳 + Cargo.lock 갱신, 커밋·태그 생성
git push origin HEAD --follow-tags
```
