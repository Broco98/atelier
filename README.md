# atelier

로컬 프로젝트·작업(Work) 데이터를 관리하는 macOS 데스크톱 앱 + CLI.
데이터는 `~/.atelier/`에 저장되며, 앱과 CLI가 `atelier-core`를 통해 같은 데이터를 읽고 씁니다.

## 설치 (릴리스)

macOS Apple Silicon 전용. 한 줄로 앱 + Gatekeeper 해제 + CLI + Claude 스킬까지 설치됩니다 (멱등 — 실패 시 재실행하면 이어서 진행):

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

**CLI** — 압축을 풀어 PATH에 놓고 Claude 스킬 설치:

```sh
tar -xzf atelier-cli-*.tar.gz
sudo mv atelier /usr/local/bin/
atelier skill install
```

</details>

## CLI 사용

```bash
atelier project list          # 프로젝트 나열
atelier project add <path>    # 코드 폴더 등록
atelier work list             # 작업 나열
atelier skill install         # AI 스킬 문서를 ~/.claude/skills/에 설치
```

## Development

- 앱: `pnpm tauri dev`
- Rust 테스트: `cargo test --workspace`
- CLI 로컬 설치: `cargo install --path crates/atelier-cli`

## Release

main에서 버전을 올리고 태그를 push하면 GitHub Actions가 dmg·앱 tar.gz·CLI tar.gz·install.sh를 빌드해 릴리스를 자동 publish합니다.

```sh
scripts/bump-version.sh 0.2.0   # 매니페스트 5곳 + Cargo.lock 갱신, 커밋·태그 생성
git push origin HEAD --follow-tags
```
