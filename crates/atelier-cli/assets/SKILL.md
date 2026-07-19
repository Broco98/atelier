---
name: atelier-projects
description: Atelier 프로젝트(~/.atelier/projects/*.md) 조회·등록·수정·제거. 사용자가 Atelier 프로젝트를 언급하거나, Works 생성 시 프로젝트 컨텍스트가 필요하거나, 코드 폴더를 Atelier에 등록해달라고 할 때 사용.
---

# Atelier Projects

Atelier는 로컬 개발 프로젝트를 관리하는 데스크톱 앱이다. 프로젝트는 AI가 Works(작업)를
만들 때 참고하는 컨텍스트다. 데이터는 `~/.atelier/projects/<slug>.md` 파일이 진실의
원천이며, 앱은 이 폴더를 감시하고 있어 파일 변경이 즉시 UI에 반영된다.

## 1순위: CLI 사용

`atelier` CLI가 있으면 항상 CLI를 사용한다 (안전한 쓰기가 보장됨):

```bash
atelier project list --json          # 모든 프로젝트 (JSON)
atelier project show <slug> --json   # 상세
atelier project add <path>           # 코드 폴더 등록
atelier project edit <slug> --description "..." --base-branch main
atelier project remove <slug> --yes  # .md만 삭제, 코드 폴더는 유지
```

- JSON 출력에는 파생 정보가 포함된다: `git.remoteSlug`, `git.currentBranch`,
  `git.localBranches`, `missing`(경로 없음).
- 종료 코드: 0 성공 / 1 오류 / 2 대상 없음.

## 2순위: 파일 직접 편집 (CLI가 없을 때만)

파일 포맷 — YAML frontmatter + 마크다운 본문(=설명):

```markdown
---
name: billing
path: ~/dev/billing
baseBranch: main
createdAt: 2026-07-19
---

결제·정산 서비스. PG 연동과 웹훅을 담당해요.
```

직접 편집 시 반드시 지킬 규칙:

1. **원자적 쓰기**: 같은 디렉토리에 임시 파일(`.<slug>.md.tmp`)을 먼저 쓰고
   `mv`로 원자적 rename 한다. 대상 파일에 직접 append/부분 쓰기 금지.
2. **모르는 frontmatter 필드는 보존**한다. 삭제·재정렬하지 말 것.
3. `path`의 홈 디렉토리는 `~`로 축약해 저장한다.
4. 파일명(slug)은 변경하지 않는다.
5. 코드 폴더(`path`가 가리키는 곳)는 절대 건드리지 않는다.
