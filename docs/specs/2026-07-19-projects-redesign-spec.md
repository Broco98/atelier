# Projects 디자인 개편 스펙 (2026-07-19)

상태: **구현 완료 — 머지 대기**
브랜치: `feat/projects-redesign` (feat/projects-v1 위에 스택 — PR #2 머지 전)

## 배경

claude.ai/design 프로젝트 "Atelier SpecOps UI 디자인 브리프"의 `Atelier.dc.html` 목업(로컬 사본: `docs/design/2026-07-19-atelier-specops-mockup.dc.html`)을 기준으로 Projects 프론트를 개편한다. 핵심 변화 두 가지:

1. **2 depth 메뉴 개편** — 단일 사이드바(272px) 안 네비 + 페이지 내부 리스트 컬럼(320px) 구조를, **Rail(1 depth 네비) + 목록 패널(2 depth)** 분리 구조로 재편.
2. **라운드 디자인** — 7px 위주 라운드를 목업의 9~14px 스케일로 전면 상향, 선택 상태는 accent 틴트+inset 링.

이 스펙은 기존 메모리의 "단일 사이드바가 최종" 결정을 **대체**한다.

## 사용자 확정 사항 (재논의 금지)

- 범위: **셸 + Projects 전체** (Rail·목록 패널·브레드크럼 바·상태바 + Projects 목록/상세/빈 상태/등록 다이얼로그). Works·Review는 레일 항목 + 빈 화면만.
- **다크 테마·검색 pill 제외** (이번 범위 밖).
- 폰트: **Geist 우선 + Pretendard 폴백**(본문), **Geist Mono**(mono). `@fontsource` 번들.
- 파일 구조: **페이지 소유** — 셸(AppShell)은 Rail+상태바만, ProjectsPage가 목록 패널+브레드크럼+상세를 소유.

## A. 셸

레이아웃: 세로 컬럼 = [가로 행: 사이드바 | 페이지 영역] + 하단 상태바 26px.

### 사이드바 (`src/components/shell/Sidebar.tsx` — **2026-07-19 사용자 정정: 구조 변경 없음, 리스타일만**)
- **기존 v1 사이드바 구조를 그대로 유지한다**: "Atelier" 텍스트 로고(text-xl), **접힘 = w-0 전체 닫기**(기존 width+opacity 트랜지션), 신호등 옆 고정 SidebarToggle 유지, 네비는 **Projects / Works만** (Review·Settings 추가하지 않는다).
- 바뀌는 것은 radius·크기·폰트뿐: 폭 272px → **248px**(`--sidebar-width`), 네비 항목 radius 7px → **10px**, 라벨 13px → **12.5px**, 항목 gap 2px → 3px.
- 상단 44px drag region, 배경 `--sidebar`, 활성 `bg-sidebar-primary/12` — 전부 현행 유지.
- (정정 이력: 목업의 Rail 아이콘 접힘 모드·"A" 로고 타일·Review 메뉴·Settings는 사용자가 반려 — 재도입 금지.)

### 브레드크럼 바 (페이지 소유, ProjectsPage 등 각 화면 상단)
- 높이 44px, border-b, drag region. 토글 버튼은 넣지 않는다(기존 SidebarToggle이 그 역할 — 정정 반영).
- 좌측: `Projects` `/` `<선택 프로젝트명>`(13px, leaf는 500). 사이드바 닫힘 시 신호등·SidebarToggle과 겹치지 않도록 좌측 패딩을 126px로 전환(열림 시 16px, 220ms 트랜지션).
- 우측(Projects, 선택 항목 있을 때): **폴더 열기**(28px 높이, radius 9, border-strong) / **제거**(red 텍스트, hover red-bg) — 상세 본문에서 이동.

### 상태바
- 26px, border-t, `--bg-panel` 배경, 11px `--text-tertiary`.
- 좌측: `~/.atelier`(mono) + "감시 중"(6px 초록 점). 목업의 "활성 작업 N / 미확인 N"은 Works·Review 데이터 도입 시 추가.

### 단축키
- **⌘B**: 사이드바 열기/닫기 (기존 유지). ⌘1/2/3·⌘\는 도입하지 않는다 (정정: Review 메뉴 제거로 무의미 + 구조 최소화).

### Works 화면 (빈 상태 전용 — Review 화면은 정정으로 제외)
- Works: 목록 패널에 "작업이 없어요 / 작업은 Claude Code에서 스킬로 시작돼요" dashed 카드(radius 14). 메인엔 목업 S5e 빈 상태(46px radius-16 아이콘 타일 + 안내문).
- 목업의 `/specops start` 코드 블록은 스킬 이름 미확정이므로 넣지 않는다.

## B. 디자인 토큰 (`src/index.css`)

추가 변수(라이트만):

```css
--bg-panel: #f7f7f8;      /* 목록 패널 배경 */
--bg-inset: #f6f6f7;      /* 인풋·코드 인셋 배경 */
--border-strong: #d2d2d7;
--text-tertiary: #8e8e97;
```

기존 매핑 유지: `--sidebar`=rail 배경, `--primary`=#5E6AD2=accent, `--border`=#e5e5e8, `--muted-foreground`=#55555e(text-2), `--accent`(rgba 5%)=bg-hover.

라운드 스케일 (rounded-[Npx]로 명시 적용, 기존 7px 전면 교체):

| 용도 | radius |
|---|---|
| 칩·배지 | 6px |
| 작은 버튼·브랜치 트리거 | 9px |
| 네비 항목·중간 버튼·로고 | 10px |
| 리스트 행·설명 박스·배너·행 컨테이너 | 12px |
| 팝오버 | 13px |
| 다이얼로그·빈 상태 dashed 카드 | 14px |

선택 상태 공통: `background: color-mix(in srgb, var(--primary) 9%, transparent)` + `box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 22%, transparent)`.

폰트: `--font-sans: 'Geist', 'Pretendard Variable', sans-serif;` + `--font-mono: 'Geist Mono', monospace;` (`@fontsource/geist-sans`, `@fontsource/geist-mono` 추가, Pretendard 패키지 유지).

## C. Projects 목록 패널 (304px, `--bg-panel`)

- 헤더 50px: "Projects"(14px/600) + 개수(11.5px, text-tertiary) / 우측 26px radius-10 (+) 버튼(border, 툴팁 "프로젝트 등록").
- 행(radius 12, padding 9px 10px, gap 4):
  - 1행: 폴더 아이콘 14px + 이름(13px/500, 선택 시 accent색, 누락 시 취소선) + 우측 누락 red 배지(radius 6). "활성 N/작업 없음" 메타는 Works 도입 전까지 생략.
  - 2행: mono 11px 경로 (padding-left 21px).
  - 3행(원격 있을 때): 브랜치 아이콘 + mono slug + 브랜치 칩(`--bg-hover`, radius 6). provider(GitHub/GitLab) 아이콘은 `GitInfo`에 host가 없어 **생략** — core 후속 티켓.
- 검색 pill 없음.
- 빈 상태: dashed border-strong radius-14 카드 — 폴더 아이콘, "프로젝트가 없어요", "로컬 저장소 폴더를 등록해 시작하세요.", accent 틴트 "프로젝트 등록" 버튼(radius 9).

## D. Projects 상세 (max-width 860px, 중앙 정렬)

- 제목 21px/600.
- 누락 배너(위쪽): red-bg + red border, radius 12 — "경로를 찾을 수 없어요. 폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나 직접 제거하세요."
- 메타 행(min-height 30px, 라벨 폭 108px, 아이콘 14px + 12.5px text-tertiary):
  - 경로: mono 12.5px (누락 시 red+취소선).
  - 원격(slug 있을 때): mono slug.
  - baseBranch: 아래 참조.
- **baseBranch 컨트롤**: `<select>` 제거 →
  - `git.localBranches` 있으면: mono 트리거 버튼(radius 9, 호버 bg-hover, chevron) → **팝오버 메뉴**(248px, radius 13, border-strong, shadow): 헤더 "브랜치 · N개", 항목(높이 30px, radius 9, mono, 현재 값에 accent 체크), 푸터 "baseBranch 설정만 바꿔요 — checkout은 하지 않아요". 바깥 클릭/Esc로 닫힘. (목업은 "원격 브랜치"지만 v1 데이터는 로컬 브랜치 — 문구는 "브랜치". 원격 브랜치 조회는 후속.)
  - 없으면: 현행 인라인 편집(클릭→input) 유지, radius 9로 리스타일.
- 설명: 헤더 "설명 · 클릭해서 편집"(13px/600 + 11.5px 안내) / 보기·편집 박스 radius 12, padding 12px 14px, 13.5px/1.65. placeholder는 italic text-tertiary "아직 설명이 없어요…". **기존 편집 로직(Esc 취소, blur 커밋, finished 가드)은 그대로 유지 — 스타일만 교체.**
- 폴더 열기/제거 버튼은 브레드크럼 바로 이동 (본문에서 제거). 제거 확인은 현행 네이티브 confirm 유지.
- 목업의 Works 섹션·PR/이슈 그리드·원격 미리보기 슬라이드 패널은 구현하지 않는다 (기능 이연 결정 유지).

## E. 등록 다이얼로그

현행 "(+) → 네이티브 피커 → 즉시 등록"을 다이얼로그 플로우로 교체:

- (+) 또는 빈 상태 버튼 → 오버레이(`rgba(18,18,24,.4)`) + 480px 다이얼로그(radius 14, border-strong, shadow, 상단에서 120px).
- 제목 "프로젝트 등록" + 부제 "로컬 저장소 폴더를 Atelier에 연결해요. 코드는 건드리지 않아요."
- 폴더 필드: 미선택 시 dashed radius-12 박스 + "폴더 선택…" 버튼(네이티브 피커 호출) / 선택 후 `--bg-inset` radius-10 박스에 mono 경로 + "변경" 버튼.
- baseBranch 필드: mono input(radius 9, 기본값 "main").
- 푸터: 취소 / 등록(accent, 폴더 미선택 시 비활성).
- 등록 동작: `create(folder)` → 생성 결과의 baseBranch와 입력값이 다르면 `update` 패치. **백엔드 변경 없음.**
- 목업 대비 생략: "git 저장소가 아니에요" 사전 검증(등록 전 probe 커맨드 없음 + v1은 git 없는 폴더 허용 — probe는 후속 티켓), "감지된 브랜치 제안" 칩(같은 이유). create 실패 시 현행 네이티브 message 에러 유지.
- Esc/오버레이 클릭으로 닫기.

## F. 구현 파일 (예상)

- `src/index.css` — 토큰·폰트·`--sidebar-width: 248px`.
- `src/components/shell/AppShell.tsx` — 컬럼+상태바 재편, nav 상태(기본 Projects). `SidebarToggle.tsx` **유지** (정정).
- `src/components/shell/Sidebar.tsx` — 구조 유지, radius 10·12.5px·gap 3px 리스타일만 (정정 — Rail 폐기).
- `src/components/shell/StatusBar.tsx` — 신규.
- `src/components/shell/PageHeader.tsx` — 신규, 공용 브레드크럼 바(루트/리프 + 우측 액션 슬롯 + 닫힘 시 좌측 패딩 전환). 토글 버튼 없음 (정정).
- `src/components/shell/PlaceholderPage.tsx` — 신규, Works 빈 화면(브레드크럼 + 목록 패널 빈 상태 + 메인 빈 상태를 props로 구성).
- `src/features/projects/` — `ProjectsPage.tsx`(목록 패널+브레드크럼+상세 배치), `ProjectList.tsx`, `ProjectDetail.tsx`(브랜치 팝오버 포함), `AddProjectDialog.tsx`(신규).

## G. 검증

- `pnpm build` 클린, `cargo test --workspace` 회귀 없음 (FE 전용 변경).
- `pnpm tauri dev` + `screencapture -x` 스크린샷 판독으로 목업 대비 확인: Rail 펼침/접힘, Projects 목록 선택 상태, 상세, 브랜치 팝오버, 등록 다이얼로그, 빈 상태, Works/Review 빈 화면.
- 스모크 후 `~/.atelier` 정리 (실데이터 폴더 규칙).

## 후속 티켓 (이번 범위 밖)

- GitInfo에 provider/host 노출 → 목록·상세 provider 아이콘.
- 등록 전 폴더 probe 커맨드(git 여부·브랜치 감지) → 다이얼로그 에러 상태·브랜치 제안.
- 다크 테마(목업 팔레트 정의됨), 검색, 상태바 카운트, Works 섹션·원격 패널 — 각 기능 도입 시.
