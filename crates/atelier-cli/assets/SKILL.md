---
name: atelier
description: Atelier 로컬 프로젝트·작업(Work) 관리. 사용자가 Atelier를 언급하거나, 여러 프로젝트에 걸친 기능 작업을 시작·정리해달라고 하거나, 프로젝트 등록이나 작업 spec 작성이 필요할 때 사용.
---

# Atelier

Atelier는 로컬 개발 프로젝트와 작업(Work)을 관리하는 데스크톱 앱이다.
`~/.atelier/`의 파일이 진실의 원천이며, 앱이 폴더를 감시해 파일 변경을
즉시 UI에 반영한다 — 파일만 쓰면 된다.

- **Project** = 등록된 로컬 git 저장소. AI가 작업을 만들 때 참고하는 컨텍스트.
- **Work** = 여러 프로젝트를 가로지르는 하나의 기능 구현 단위. 프로젝트별
  git worktree와 spec 문서를 담는다.

모든 조회·쓰기는 `atelier` CLI로 한다 (검증·원자적 쓰기 보장). CLI를 실행할
수 없을 때만 이 스킬 폴더의 [manual-editing.md](manual-editing.md)를 읽고
파일을 직접 편집한다.

## CLI

```bash
# 프로젝트
atelier project list --json          # 모든 프로젝트 (JSON)
atelier project show <slug> --json   # 상세
atelier project add <path>           # 코드 폴더 등록
atelier project edit <slug> --description "..." --base-branch main
atelier project remove <slug> --yes  # .md만 삭제, 코드 폴더는 유지

# 작업
atelier work start "<제목>" --project <slug> [--project <slug>…] [--branch <이름>] --json
atelier work list --json
atelier work show <slug> --json      # 워크트리 경로·spec 파일 목록 포함
atelier work edit <slug> --status <active|review|done>
atelier work attach <slug> <project> # 진행 중 작업에 프로젝트 추가
atelier work remove <slug> --yes     # 워크트리 정리, 브랜치는 유지
```

- 종료 코드: 0 성공 / 1 오류 / 2 대상 없음.
- `work start`는 사전검증 실패 시 아무것도 만들지 않고(원자적), 부분 실패 후
  같은 명령을 재실행하면 빠진 것만 이어서 만든다(멱등).

## 작업 시작 흐름

사용자가 "~기능 작업 시작해줘"라고 하면:

1. `atelier project list --json`으로 등록된 프로젝트와 설명을 읽는다.
2. 기능에 필요한 프로젝트를 고른다 (frontend+backend처럼 복수 가능).
   사용자가 명시했으면 그대로 따른다.
3. **브랜치명은 대상 저장소의 기존 컨벤션을 따른다** — 저장소의 브랜치 목록을
   보고 `feat/…`, `feature/…` 같은 기존 패턴에 맞춘다. 모든 프로젝트가 같은
   브랜치명을 공유한다.
4. `atelier work start "<제목>" --project … --branch … --json` 실행.
   결과 JSON의 `trees[].path`가 코드 작업 위치, spec은 `~/.atelier/works/<slug>/spec/`.

## spec 작성 규약

- 작업을 시작하면 `spec/overview.md`부터 작성한다. 필요하면 파일을 자유롭게
  추가한다 (`architecture.md`, 하위 폴더 등). 마크다운 중심, mermaid 다이어그램 권장.
- **블록 참조 해석**: 사용자가 `spec/overview.md:L19-27` 형식을 붙여넣으면
  해당 작업의 `spec/overview.md` 19–27번째 줄을 가리킨다. 그 부분을 읽고
  지시에 반영한다.
- 코드 작업은 반드시 해당 작업의 워크트리(`trees/<project>/`)에서 한다.
  프로젝트 원본 폴더의 체크아웃 상태를 건드리지 않는다.
