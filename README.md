# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

- 앱: `pnpm tauri dev`
- Rust 테스트: `cargo test --workspace`

## CLI

로컬 설치: `cargo install --path crates/atelier-cli`

```bash
atelier project list          # 프로젝트 나열
atelier project add <path>    # 코드 폴더 등록
atelier skill install         # AI 스킬 문서를 ~/.claude/skills/에 설치
```

데이터는 `~/.atelier/projects/*.md`에 저장됩니다.
