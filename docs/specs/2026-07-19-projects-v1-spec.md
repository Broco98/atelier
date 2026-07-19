# Projects v1 스펙

> 상태: 구현됨 (2026-07-19)
> 작성일: 2026-07-19

## 1. 범위

**포함**: 프로젝트 목록·추가·상세·편집(설명, baseBranch)·제거, `~/.atelier` 파일 저장,
git 자동 감지, 누락 상태 표시, `atelier` CLI(풀 CRUD + `--json`), AI 스킬 문서 및 설치 명령.

**제외 (이후 버전)**: Works 섹션, GitLab/GitHub 연동, '활성 N' 배지, 하단 상태바,
누락 프로젝트 경로 재연결, 커스텀 데이터 폴더 위치.

## 2. 데이터 모델

### 2.1 파일 레이아웃

```
~/.atelier/
└── projects/
    ├── billing.md
    └── web-api.md
```

- 앱 시작 시와 CLI 명령 실행 시 `~/.atelier/projects/`가 없으면 생성한다.
- 파일명(`<slug>.md`)이 프로젝트의 고유 식별자다.

### 2.2 프로젝트 파일 포맷

YAML frontmatter + 마크다운 본문(= 설명):

```markdown
---
name: billing
path: ~/dev/billing
baseBranch: main
createdAt: 2026-07-19
---

결제·정산 서비스. PG 연동과 웹훅을 담당해요.
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `name` | string | 표시 이름. 기본값은 폴더명 |
| `path` | string | 코드 폴더 경로. 홈 디렉토리는 `~`로 축약해 저장, 로드 시 확장 |
| `baseBranch` | string | Works 생성 시 기준 브랜치 |
| `createdAt` | string | `YYYY-MM-DD` |

- **알 수 없는 frontmatter 필드는 보존한다** (읽기 → 수정 → 쓰기 라운드트립에서 유실 금지).
  AI나 이후 버전이 추가한 필드를 앱이 지우지 않기 위함.
- 본문(설명)은 자유 마크다운. 빈 본문 허용.

### 2.3 slug 규칙

- 폴더명에서 파생: 소문자화(ASCII), 공백 → `-`, `/` 등 경로 구분자·제어 문자 제거.
- 한글 등 유니코드 문자는 그대로 허용 (파일명으로 유효하므로).
- 충돌 시 `-2`, `-3`… suffix.
- slug는 생성 시 한 번 결정되며 이름 변경은 v1 범위 밖.

### 2.4 파생 데이터 (저장하지 않음)

로드 시 파일시스템/git에서 계산:

| 파생 필드 | 출처 |
|---|---|
| `missing` | `path`가 존재하지 않으면 `true` |
| `git.remoteSlug` | `origin` URL에서 `owner/repo` 추출 (SSH/HTTPS 모두 지원). 없으면 `null` |
| `git.currentBranch` | `git -C <path> branch --show-current` |
| `git.localBranches` | baseBranch 드롭다운용 로컬 브랜치 목록 |

- git 감지는 **`git` 바이너리 shell-out** (`git2` 크레이트 미사용 — 의존성 무겁고, 대상
  사용자는 개발자라 git이 항상 존재). git이 없거나 repo가 아니면 `git: null`.
- git 없는 폴더도 프로젝트로 허용. UI에서 remote/브랜치 표기만 생략.

## 3. 경합 조건 처리

- **원자적 쓰기**: 같은 디렉토리에 `.<slug>.md.tmp` 작성 → `rename`. 부분 쓰기 파일이
  관측될 수 없음.
- **충돌 정책**: last-write-wins. 락 파일 없음.
- **워처**: Rust `notify` + 디바운서(500ms)로 `~/.atelier/projects/` 감시.
  변경 시 프론트에 `projects:changed` 이벤트 emit → TanStack Query
  `invalidateQueries(['projects'])`.
  - dotfile(`.`으로 시작)과 `.tmp`는 무시 → 자기 쓰기의 tmp 단계에 반응하지 않음.
  - 앱 자신의 쓰기 완료(rename)도 이벤트로 잡히지만, 결과는 리로드뿐이라 무해(멱등).

## 4. 코드 아키텍처

```
atelier/                        # Cargo 워크스페이스 루트 (Cargo.toml 신규)
├── crates/
│   ├── atelier-core/           # 모든 도메인 로직
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── project.rs      # 모델 + frontmatter 직렬화/파싱 (라운드트립)
│   │       ├── store.rs        # list/get/create/update/delete + 원자적 쓰기
│   │       ├── slug.rs
│   │       └── git.rs          # shell-out 감지
│   └── atelier-cli/            # `atelier` 바이너리 (clap)
│       ├── src/main.rs
│       └── assets/SKILL.md     # include_str!로 내장
├── src-tauri/                  # 워크스페이스 멤버로 편입. 커맨드 → core 호출 + 워처
└── src/
    └── features/projects/      # FE feature 모듈
        ├── ProjectsPage.tsx    # 2컬럼 레이아웃 조립
        ├── ProjectList.tsx
        ├── ProjectDetail.tsx
        ├── api.ts              # invoke 래퍼 + 쿼리 정의
        ├── hooks.ts            # useProjects 등 (Query 래핑)
        └── types.ts            # ProjectView 등 TS 타입 (Rust와 수동 동기화)
```

### 4.1 core 공개 API (요지)

```rust
pub struct Project {
    pub slug: String,
    pub name: String,
    pub path: String,          // ~ 축약형 그대로
    pub base_branch: String,
    pub description: String,
    pub created_at: String,
    pub extra: serde_yaml::Mapping, // 알 수 없는 필드 보존
}

pub struct GitInfo {
    pub remote_slug: Option<String>,
    pub current_branch: Option<String>,
    pub local_branches: Vec<String>,
}

pub struct ProjectView {
    pub project: Project,
    pub git: Option<GitInfo>,
    pub missing: bool,
}

pub fn list_projects(root: &Path) -> Result<Vec<ProjectView>>;
pub fn get_project(root: &Path, slug: &str) -> Result<ProjectView>;
pub fn create_project(root: &Path, folder: &Path) -> Result<ProjectView>;
pub fn update_project(root: &Path, slug: &str, patch: ProjectPatch) -> Result<ProjectView>;
pub fn delete_project(root: &Path, slug: &str) -> Result<()>;

pub struct ProjectPatch {
    pub description: Option<String>,
    pub base_branch: Option<String>,
}
```

- `create_project`: 동일 `path`의 프로젝트가 이미 있으면 **에러가 아니라 기존 프로젝트 반환**
  (중복 등록 방지, 멱등).
- `create_project`의 초기값: `name` = 폴더명, `baseBranch` = origin/HEAD → 현재 브랜치 →
  `main` 순 폴백, `description` = 빈 문자열.
- 직렬화 시 JSON은 camelCase (`serde(rename_all = "camelCase")`).

### 4.2 Tauri 커맨드

core 함수를 1:1로 감싼 것 + 다음:

- `open_project_folder(slug)` — opener 플러그인으로 Finder에서 열기.
- 폴더 선택은 `tauri-plugin-dialog`의 folder picker 사용 (FE에서 호출).
- 워처는 앱 setup에서 시작, `projects:changed` emit.

### 4.3 신규 의존성

| 위치 | 의존성 | 용도 |
|---|---|---|
| FE | `@tanstack/react-query` | 데이터 상태 |
| FE | `@tauri-apps/plugin-dialog` | 폴더 선택 |
| Rust core | `serde_yaml_ng`, `thiserror`, `dirs` | frontmatter, 에러, 홈 경로 |
| Rust cli | `clap`, `serde_json`, `anyhow` | CLI |
| src-tauri | `notify`, `notify-debouncer-mini`, `tauri-plugin-dialog` | 워처, 다이얼로그 |

## 5. CLI

바이너리 이름 `atelier`. 설치는 v1에서 `cargo install --path crates/atelier-cli` (문서화).

```
atelier project list [--json]
atelier project show <slug> [--json]
atelier project add <path> [--json]
atelier project edit <slug> [--description <text>] [--base-branch <name>] [--json]
atelier project remove <slug> [--yes]
atelier skill install            # → ~/.claude/skills/atelier-projects/SKILL.md
```

- 기본 출력은 사람용 표/텍스트, `--json`이면 `ProjectView` JSON (camelCase).
- `remove`는 TTY에서 확인 프롬프트, `--yes`로 생략.
- 종료 코드: `0` 성공, `1` 일반 오류, `2` 대상 없음(not found).
- `edit`에 플래그가 하나도 없으면 오류 + 사용법 출력.

## 6. 스킬 문서 (SKILL.md)

`crates/atelier-cli/assets/SKILL.md`에서 버전 관리, CLI에 내장, `atelier skill install`로
`~/.claude/skills/atelier-projects/`에 설치. 내용:

- Atelier 프로젝트의 목적 (Works 생성 시 AI가 참고하는 컨텍스트)
- 데이터 위치와 파일 포맷 (frontmatter 스키마, 본 스펙 §2 요약)
- **CLI 사용을 1순위로 권장** (`atelier project ... --json`)
- CLI가 없을 때 파일 직접 편집 규칙: 같은 디렉토리 tmp 파일 → rename, 알 수 없는 필드 보존

## 7. UI

콘텐츠 영역(기존 `<main>`)에 2컬럼. 사이드바 "Projects" 선택 시 렌더.

### 7.1 리스트 컬럼 (고정 320px, 우측 border)

- 헤더: `PROJECTS` 레이블 + 우측 `+` 버튼.
- 항목: 폴더 아이콘 + 이름 / 경로(`~` 축약) / remote가 있으면 `owner/repo` + 현재 브랜치 뱃지.
- 누락 항목: 이름 취소선 + 빨간 `누락` 뱃지, git 줄 생략.
- 선택: 클릭 시 상세 표시. 초기 진입 시 첫 항목 자동 선택. 선택 항목 배경 하이라이트.
- 빈 상태: 안내 문구 + 프로젝트 추가 버튼.

### 7.2 상세 패널

- 상단: 프로젝트 이름(대형) + 우측 `폴더 열기`(보조 버튼), `제거`(빨간 텍스트 버튼).
- 속성 행: 경로 / 원격(`owner/repo`, 없으면 행 생략) / baseBranch.
  - baseBranch: git 있으면 `localBranches` 드롭다운으로 변경 가능, 없으면 텍스트만.
- 설명: "클릭해서 편집" — 클릭 시 textarea 전환, blur 또는 `⌘Enter`로 저장, `Esc` 취소.
- 제거: 확인 다이얼로그("코드 폴더는 삭제되지 않습니다" 명시) → `.md` 삭제 → 목록의
  다음 항목 선택(없으면 빈 상태).
- 누락 프로젝트: 상세에 누락 안내 배너, `폴더 열기` 비활성.

### 7.3 추가 플로우

`+` 클릭 → 네이티브 폴더 선택 → 즉시 생성 → 새 항목 선택 상태로 상세 표시.
이미 등록된 폴더를 고르면 해당 항목을 선택만 한다 (§4.1 멱등).

## 8. 테스트 전략

- **atelier-core: cargo test로 TDD.** frontmatter 라운드트립(unknown 필드 보존 포함),
  slug 규칙·충돌, create/update/delete, 원자적 쓰기, 동일 path 멱등, git 감지(fixture repo).
- **CLI**: 명령→종료코드·JSON 형태 통합 테스트 (assert_cmd).
- **FE**: Vitest 셋업은 기존 결정대로 보류. `pnpm build` + playwright-cli 수동 검증으로 확인.

## 9. 미결/후속

- CLI 배포 채널(앱 번들 동봉, brew 등) — v1은 cargo install 문서화로 충분.
- 프로젝트 이름 변경(= slug 변경) — Works 참조 등장 시 함께 설계.
- 워처의 세밀한 이벤트(생성/수정/삭제 구분) — v1은 전체 무효화로 충분.
