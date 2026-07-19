# 파일 직접 편집 (CLI를 실행할 수 없을 때만)

프로젝트 파일 — `~/.atelier/projects/<slug>.md`, YAML frontmatter + 마크다운 본문(=설명):

```markdown
---
name: billing
path: ~/dev/billing
baseBranch: main
createdAt: 2026-07-19
---

결제·정산 서비스. PG 연동과 웹훅을 담당해요.
```

작업 메타 파일 — `~/.atelier/works/<slug>/work.json`:

```json
{
  "title": "카트 아이템 추가",
  "status": "active",
  "branch": "feat/cart-add-item",
  "createdAt": "2026-07-19",
  "projects": ["frontend", "backend"]
}
```

반드시 지킬 규칙:

1. **원자적 쓰기**: 같은 디렉토리에 임시 파일(`.<이름>.tmp`)을 먼저 쓰고
   `mv`로 원자적 rename 한다. 대상 파일에 직접 append/부분 쓰기 금지.
2. **모르는 필드는 보존**한다. 삭제·재정렬하지 말 것.
3. `path`의 홈 디렉토리는 `~`로 축약해 저장한다.
4. 파일명(slug)·디렉터리명은 변경하지 않는다.
5. 코드 폴더(`path`)와 워크트리 생성·제거는 git 명령이 필요하므로 CLI 없이
   임의로 흉내 내지 않는다. spec 파일 작성은 자유.
