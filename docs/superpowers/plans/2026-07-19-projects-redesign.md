# Projects 디자인 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** claude.ai/design 목업 기준으로 셸을 Rail(248/60px)+목록 패널(304px)+페이지 소유 브레드크럼+상태바 구조로 재편하고, Projects 전체를 라운드 디자인으로 리스타일한다.

**Architecture:** 셸(AppShell)은 Rail+상태바+nav 상태만 소유하고, 각 페이지(ProjectsPage, PlaceholderPage)가 목록 패널·브레드크럼·본문을 소유한다. 백엔드(crates, src-tauri)는 건드리지 않는다 — 등록 다이얼로그의 baseBranch는 `create → update` 2단 호출로 구현한다.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 + TanStack Query + Tauri 2 plugin-dialog. 스펙: `docs/specs/2026-07-19-projects-redesign-spec.md`, 참조 목업: `docs/design/2026-07-19-atelier-specops-mockup.dc.html`.

## Global Constraints

- **FE 전용**: `src/` 밖(`crates/`, `src-tauri/`)은 수정 금지.
- **테스트**: Vitest 셋업 보류 중(사용자 결정) — 각 태스크의 검증은 `pnpm build`(tsc+vite) 통과. GUI 시각 검증은 Task 10에서 일괄 수행.
- **브랜치**: `feat/projects-redesign`. 커밋 전 반드시 `git status --short --branch`로 브랜치 확인 (사용자 IDE가 브랜치를 바꿀 수 있음).
- **커밋 메시지 트레일러** (모든 커밋 끝에):
  ```
  KimHyoYeon
  Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
  ```
- **라운드 스케일** (rounded-[Npx] 명시, 기존 7px 금지): 칩·배지 6px / 작은 버튼 9px / 네비 항목·중간 버튼·로고 10px / 리스트 행·설명 박스·배너 12px / 팝오버 13px / 다이얼로그·dashed 카드 14px.
- **선택 상태**: `selected-ring` 유틸리티(Task 1 정의)만 사용 — accent 9% 배경 + inset 1px accent 22% 링.
- **색상 토큰**: `--bg-panel: #f7f7f8`, `--bg-inset: #f6f6f7`, `--border-strong: #d2d2d7`, `--text-tertiary: #8e8e97`. Tailwind 클래스: `bg-panel`, `bg-inset`, `border-border-strong`, `text-tertiary`. 초록 점·아이콘은 `#0f7b52` arbitrary 값.
- **UI 문구**: 아래 태스크의 한국어 카피를 글자 그대로 사용 ("-요" 톤).
- **다크 테마·검색·provider 아이콘 없음** (스펙의 후속 티켓 — 추가하지 말 것).

---

### Task 1: 디자인 토큰 + 폰트

**Files:**
- Modify: `src/index.css`
- Modify: `package.json` (pnpm add로)

**Interfaces:**
- Produces: Tailwind 클래스 `bg-panel`, `bg-inset`, `border-border-strong`(및 `text-border-strong`), `text-tertiary`, 유틸리티 `selected-ring`. 폰트 `font-sans`(Geist→Pretendard 폴백), `font-mono`(Geist Mono). 이후 모든 태스크가 사용.

- [ ] **Step 1: 폰트 패키지 설치**

Run: `pnpm add @fontsource-variable/geist @fontsource-variable/geist-mono`
Expected: package.json dependencies에 두 패키지 추가.
(만약 패키지가 존재하지 않아 실패하면 `pnpm add @fontsource/geist-sans @fontsource/geist-mono`로 대체하고, Step 2의 family 명을 `'Geist Sans'`, `'Geist Mono'`로, import 경로를 `@fontsource/geist-sans`·`@fontsource/geist-mono`로 바꾼다.)

- [ ] **Step 2: index.css 수정**

`src/index.css` 상단 import 블록을 다음으로 교체 (기존 4줄 → 6줄):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";
@import "pretendard/dist/web/variable/pretendardvariable.css";
```

`@theme inline` 블록에서 기존 `--font-heading`/`--font-sans` 2줄을 다음으로 교체:

```css
    --font-heading: var(--font-sans);
    --font-sans: 'Geist Variable', 'Pretendard Variable', sans-serif;
    --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace;
```

`@theme inline` 블록 안(예: `--color-background` 줄 다음)에 색상 매핑 4줄 추가:

```css
    --color-panel: var(--bg-panel);
    --color-inset: var(--bg-inset);
    --color-border-strong: var(--border-strong);
    --color-tertiary: var(--text-tertiary);
```

`:root` 블록(라이트 팔레트) 끝에 변수 4개 추가:

```css
    --bg-panel: #f7f7f8;
    --bg-inset: #f6f6f7;
    --border-strong: #d2d2d7;
    --text-tertiary: #8e8e97;
```

파일 끝(`@layer base` 뒤)에 유틸리티 추가:

```css
@utility selected-ring {
  background: color-mix(in srgb, var(--primary) 9%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 22%, transparent);
}
```

`.dark` 블록은 건드리지 않는다 (다크 테마는 범위 밖 — :root 값이 그대로 상속되어도 무방).

- [ ] **Step 3: 빌드 확인**

Run: `pnpm build`
Expected: 에러 없이 완료 (`vite build` 성공 출력).

- [ ] **Step 4: 커밋**

```bash
git status --short --branch   # feat/projects-redesign 확인
git add src/index.css package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(fe): 디자인 토큰·Geist 폰트·selected-ring 유틸리티

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 2: nav-items에 Review 추가 + Rail 컴포넌트

**Files:**
- Modify: `src/components/shell/nav-items.ts`
- Create: `src/components/shell/Rail.tsx`
- Delete: `src/components/shell/Sidebar.tsx`
- Modify: `src/components/shell/AppShell.tsx` (import 교체만)

**Interfaces:**
- Consumes: Task 1의 토큰.
- Produces: `NavKey = "review" | "projects" | "works"`. `Rail` 컴포넌트 props `{ open: boolean; activeKey: NavKey; onSelect: (key: NavKey) => void }` (default export). Task 4가 사용.

- [ ] **Step 1: nav-items.ts 교체**

```ts
import { Folder, Inbox, Zap, type LucideIcon } from "lucide-react";

export const navItems = [
  { key: "review", label: "Review", icon: Inbox },
  { key: "projects", label: "Projects", icon: Folder },
  { key: "works", label: "Works", icon: Zap },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];

export type NavKey = (typeof navItems)[number]["key"];
```

- [ ] **Step 2: Rail.tsx 생성**

```tsx
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItems, type NavKey } from "./nav-items";

interface RailProps {
  open: boolean;
  activeKey: NavKey;
  onSelect: (key: NavKey) => void;
}

// 펼침 248px / 접힘 60px 아이콘 모드. w-0으로 사라지지 않는다.
// 상단 44px 스트립은 macOS 신호등 영역 — drag region 유지.
function Rail({ open, activeKey, onSelect }: RailProps) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-r bg-sidebar pb-2.5 transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        open ? "w-[248px]" : "w-[60px]",
      )}
    >
      <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />

      <div className={cn("flex h-11 shrink-0 items-center gap-[9px]", open ? "px-[14px]" : "justify-center")}>
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-[13px] font-bold text-primary-foreground">
          A
        </div>
        {open && (
          <span className="whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.01em] text-sidebar-foreground">
            Atelier
          </span>
        )}
      </div>

      <nav className={cn("flex flex-1 flex-col gap-[3px] pt-1", open ? "px-2" : "items-center")}>
        {navItems.map((item, i) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              title={open ? undefined : `${item.label} ⌘${i + 1}`}
              className={cn(
                "flex items-center transition-colors",
                open ? "h-8 w-full gap-[9px] rounded-[10px] px-[9px]" : "size-[38px] justify-center rounded-[12px]",
                active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-sidebar-accent",
              )}
            >
              <item.icon className="size-[17px] shrink-0" strokeWidth={1.7} />
              {open && <span className="truncate text-[12.5px] font-medium">{item.label}</span>}
            </button>
          );
        })}

        <button
          type="button"
          disabled
          title="Settings — 이번 범위 밖"
          className={cn(
            "mt-auto flex items-center text-muted-foreground opacity-55",
            open ? "h-8 w-full gap-[9px] rounded-[10px] px-[9px]" : "size-[38px] justify-center rounded-[12px]",
          )}
        >
          <SlidersHorizontal className="size-[17px] shrink-0" strokeWidth={1.7} />
          {open && <span className="text-[12.5px] font-medium">Settings</span>}
        </button>
      </nav>
    </aside>
  );
}

export default Rail;
```

- [ ] **Step 3: Sidebar.tsx 삭제 + AppShell import 교체**

`rm src/components/shell/Sidebar.tsx` 후, `src/components/shell/AppShell.tsx`에서:
- `import Sidebar from "./Sidebar";` → `import Rail from "./Rail";`
- `<Sidebar open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />` → `<Rail open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />`

다른 줄은 이 태스크에서 건드리지 않는다 (전면 개편은 Task 4).

- [ ] **Step 4: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git status --short --branch
git add src/components/shell/nav-items.ts src/components/shell/Rail.tsx src/components/shell/Sidebar.tsx src/components/shell/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(fe): Rail 컴포넌트 — 접힘 아이콘 모드, Review 네비 추가

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 3: PageHeader + StatusBar + PlaceholderPage

**Files:**
- Create: `src/components/shell/PageHeader.tsx`
- Create: `src/components/shell/StatusBar.tsx`
- Create: `src/components/shell/PlaceholderPage.tsx`

**Interfaces:**
- Consumes: Task 1의 토큰.
- Produces (Task 4·6이 사용):
  - `PageHeader` props `{ root: string; leaf?: string; actions?: React.ReactNode; sidebarOpen: boolean; onToggleSidebar: () => void }` (default export)
  - `StatusBar` props 없음 (default export)
  - `PlaceholderPage` props `{ root: string; listHeader: string; listHint: string; listEmpty?: { icon: LucideIcon; title: string; body: string }; main: { icon: LucideIcon; title: string; body: string; mono?: string; green?: boolean }; sidebarOpen: boolean; onToggleSidebar: () => void }` (default export)

- [ ] **Step 1: PageHeader.tsx 생성**

```tsx
import { PanelLeft } from "lucide-react";

interface PageHeaderProps {
  root: string;
  leaf?: string;
  actions?: React.ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// 페이지 소유 브레드크럼 바 — 메인 영역의 44px 타이틀바를 겸한다 (drag region).
function PageHeader({ root, leaf, actions, sidebarOpen, onToggleSidebar }: PageHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-(--titlebar-height) shrink-0 items-center justify-between gap-3 border-b px-4"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-tertiary">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="사이드바 토글"
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? "사이드바 접기 ⌘B" : "사이드바 펼치기 ⌘B"}
          className="mr-1 flex size-[26px] shrink-0 items-center justify-center rounded-[9px] text-tertiary transition-colors hover:bg-accent hover:text-muted-foreground"
        >
          <PanelLeft className="size-[15px]" strokeWidth={1.7} />
        </button>
        <span data-tauri-drag-region className="shrink-0">{root}</span>
        {leaf && (
          <>
            <span className="text-border-strong">/</span>
            <span className="min-w-0 truncate font-medium text-foreground">{leaf}</span>
          </>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;
```

- [ ] **Step 2: StatusBar.tsx 생성**

```tsx
// 하단 상태바 — 활성 작업/미확인 카운트는 Works·Review 데이터 도입 시 추가 (스펙 후속 티켓).
function StatusBar() {
  return (
    <footer className="flex h-[26px] shrink-0 items-center border-t bg-panel px-3 text-[11px] text-tertiary">
      <div className="flex items-center gap-3.5">
        <span className="font-mono">~/.atelier</span>
        <span className="flex items-center gap-[5px]">
          <span className="size-1.5 rounded-full bg-[#0f7b52]" />
          감시 중
        </span>
      </div>
    </footer>
  );
}

export default StatusBar;
```

- [ ] **Step 3: PlaceholderPage.tsx 생성**

```tsx
import type { LucideIcon } from "lucide-react";
import PageHeader from "./PageHeader";

interface EmptyCard {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface PlaceholderPageProps {
  root: string;
  listHeader: string;
  listHint: string;
  listEmpty?: EmptyCard;
  main: EmptyCard & { mono?: string; green?: boolean };
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// Works·Review 공용 빈 화면 — 목록 패널(304px) + 브레드크럼 + 메인 빈 상태.
function PlaceholderPage({
  root,
  listHeader,
  listHint,
  listEmpty,
  main,
  sidebarOpen,
  onToggleSidebar,
}: PlaceholderPageProps) {
  const MainIcon = main.icon;
  const ListIcon = listEmpty?.icon;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[304px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
        <div data-tauri-drag-region className="flex h-[50px] shrink-0 items-center justify-between px-0.5">
          <span className="text-sm font-semibold tracking-[-0.01em]">{listHeader}</span>
          <span className="text-[11.5px] text-tertiary">{listHint}</span>
        </div>
        {listEmpty && ListIcon && (
          <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
            <ListIcon className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
            <span className="text-[12.5px] font-medium text-muted-foreground">{listEmpty.title}</span>
            <span className="text-[11.5px] leading-normal text-tertiary">{listEmpty.body}</span>
          </div>
        )}
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root={root} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="flex max-w-[400px] flex-col items-center gap-2.5 text-center">
            {main.green ? (
              <span className="flex size-12 items-center justify-center rounded-full bg-[#0f7b52]/10 text-[#0f7b52]">
                <MainIcon className="size-[22px]" strokeWidth={1.8} />
              </span>
            ) : (
              <div className="mb-2 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                <MainIcon className="size-5" strokeWidth={1.6} />
              </div>
            )}
            <span className="text-base font-semibold tracking-[-0.01em]">{main.title}</span>
            <span className="text-[13px] leading-[1.65] text-muted-foreground">{main.body}</span>
            {main.mono && <span className="font-mono text-[11.5px] text-tertiary">{main.mono}</span>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default PlaceholderPage;
```

- [ ] **Step 4: 빌드 확인**

Run: `pnpm build`
Expected: PASS (신규 파일 3개는 아직 미사용 — tsconfig가 unused **file**은 에러로 잡지 않으므로 통과).

- [ ] **Step 5: 커밋**

```bash
git status --short --branch
git add src/components/shell/PageHeader.tsx src/components/shell/StatusBar.tsx src/components/shell/PlaceholderPage.tsx
git commit -m "$(cat <<'EOF'
feat(fe): PageHeader·StatusBar·PlaceholderPage 셸 컴포넌트

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 4: AppShell 재편 — 컬럼 레이아웃 + ⌘1/2/3 + 빈 화면 연결

**Files:**
- Modify: `src/components/shell/AppShell.tsx` (전면 교체)

**Interfaces:**
- Consumes: `Rail`(Task 2), `StatusBar`·`PlaceholderPage`(Task 3), `NavKey`.
- Produces: 없음 (최상위). **주의**: Projects 화면은 이 태스크에서 임시로 기존 44px 헤더 래퍼를 유지하고 `SidebarToggle`도 그대로 둔다 — Task 6에서 ProjectsPage가 자체 브레드크럼을 갖게 되면 둘 다 제거된다.

- [ ] **Step 1: AppShell.tsx 전체 교체**

```tsx
import { useEffect, useState } from "react";
import { Inbox, Zap } from "lucide-react";
import Rail from "./Rail";
import SidebarToggle from "./SidebarToggle";
import StatusBar from "./StatusBar";
import PlaceholderPage from "./PlaceholderPage";
import ProjectsPage from "@/features/projects/ProjectsPage";
import type { NavKey } from "./nav-items";

const SIDEBAR_OPEN_KEY = "sidebar-open";
const NAV_SHORTCUTS: Record<string, NavKey> = {
  Digit1: "review",
  Digit2: "projects",
  Digit3: "works",
};

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0",
  );
  const [activeKey, setActiveKey] = useState<NavKey>("projects");

  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      if (e.code === "KeyB") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      const nav = NAV_SHORTCUTS[e.code];
      if (nav) {
        e.preventDefault();
        setActiveKey(nav);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleSidebar = () => setSidebarOpen((open) => !open);

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Rail open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />
        {activeKey === "projects" && (
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Task 6에서 ProjectsPage가 자체 브레드크럼을 가지면 이 래퍼를 제거한다 */}
            <header data-tauri-drag-region className="h-(--titlebar-height) shrink-0 border-b" />
            <ProjectsPage />
          </main>
        )}
        {activeKey === "review" && (
          <PlaceholderPage
            root="Review"
            listHeader="Inbox"
            listHint="모두 리뷰됨"
            main={{
              icon: Inbox,
              title: "인박스 제로",
              body: "새로 리뷰할 스펙이 없어요.",
              mono: "감시 중 · 변경이 오면 다시 떠요",
              green: true,
            }}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        )}
        {activeKey === "works" && (
          <PlaceholderPage
            root="Works"
            listHeader="Works"
            listHint="0"
            listEmpty={{
              icon: Zap,
              title: "작업이 없어요",
              body: "작업은 Claude Code에서 스킬로 시작돼요.",
            }}
            main={{
              icon: Zap,
              title: "아직 작업이 없어요",
              body: "작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
            }}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </div>
      <StatusBar />
      <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />
    </div>
  );
}

export default AppShell;
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git status --short --branch
git add src/components/shell/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(fe): AppShell 재편 — 상태바·⌘1/2/3·Works/Review 빈 화면

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 5: ProjectList 개편 — 304px 패널 + 라운드 행

**Files:**
- Modify: `src/features/projects/ProjectList.tsx` (전면 교체)

**Interfaces:**
- Consumes: Task 1의 토큰·`selected-ring`. props는 기존과 동일 유지: `{ projects: ProjectView[]; selectedSlug: string | null; onSelect: (slug: string) => void; onAdd: () => void }`.
- Produces: 동일 props의 리스타일된 컴포넌트 (ProjectsPage가 그대로 사용).

- [ ] **Step 1: ProjectList.tsx 전체 교체**

```tsx
import { Folder, GitBranch, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectView } from "./types";

interface ProjectListProps {
  projects: ProjectView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onAdd: () => void;
}

function ProjectList({ projects, selectedSlug, onSelect, onAdd }: ProjectListProps) {
  return (
    <div className="flex w-[304px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
      <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
      <div data-tauri-drag-region className="flex h-[50px] shrink-0 items-center justify-between px-0.5">
        <span className="flex items-baseline gap-[7px]">
          <span className="text-sm font-semibold tracking-[-0.01em]">Projects</span>
          <span className="text-[11.5px] text-tertiary">{projects.length}</span>
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label="프로젝트 등록"
          title="프로젝트 등록"
          className="flex size-[26px] items-center justify-center rounded-[10px] border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
          <Folder className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
          <span className="text-[12.5px] font-medium text-muted-foreground">프로젝트가 없어요</span>
          <span className="text-[11.5px] leading-normal text-tertiary">
            로컬 저장소 폴더를 등록해 시작하세요.
          </span>
          <button
            type="button"
            onClick={onAdd}
            className="mt-1.5 h-[26px] rounded-[9px] bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            프로젝트 등록
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto pb-2">
          {projects.map((project) => {
            const active = project.slug === selectedSlug;
            return (
              <button
                key={project.slug}
                type="button"
                onClick={() => onSelect(project.slug)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-[12px] px-[10px] py-[9px] text-left transition-colors",
                  active ? "selected-ring" : "hover:bg-accent",
                )}
              >
                <span className="flex w-full items-center gap-[7px]">
                  <Folder className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px] font-medium",
                      active && "text-primary",
                      project.missing && "text-muted-foreground line-through",
                    )}
                  >
                    {project.name}
                  </span>
                  {project.missing && (
                    <span className="shrink-0 rounded-[6px] bg-red-500/10 px-1.5 text-[10.5px] font-medium text-red-600">
                      누락
                    </span>
                  )}
                </span>
                <span className="truncate pl-[21px] font-mono text-[11px] text-tertiary">
                  {project.path}
                </span>
                {project.git?.remoteSlug && (
                  <span className="flex items-center gap-1.5 pl-[21px] font-mono text-[11px] text-tertiary">
                    <GitBranch className="size-[11px] shrink-0" strokeWidth={1.7} />
                    <span className="truncate">{project.git.remoteSlug}</span>
                    {project.git.currentBranch && (
                      <span className="shrink-0 rounded-[6px] bg-accent px-[5px] text-[10.5px]">
                        {project.git.currentBranch}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProjectList;
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git status --short --branch
git add src/features/projects/ProjectList.tsx
git commit -m "$(cat <<'EOF'
feat(fe): ProjectList 개편 — 304px 패널·라운드 행·selected-ring

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 6: ProjectsPage 개편 — 브레드크럼 + 액션 이동

**Files:**
- Modify: `src/features/projects/ProjectsPage.tsx` (전면 교체)
- Modify: `src/features/projects/ProjectDetail.tsx` (상단 버튼·onDeleted 제거)
- Modify: `src/components/shell/AppShell.tsx` (임시 래퍼·SidebarToggle 제거)
- Delete: `src/components/shell/SidebarToggle.tsx`

**Interfaces:**
- Consumes: `PageHeader`(Task 3), `ProjectList`(Task 5), `projectsApi`·hooks(기존).
- Produces: `ProjectsPage` props `{ sidebarOpen: boolean; onToggleSidebar: () => void }` (default export). `ProjectDetail` props는 `{ project: ProjectView }`로 축소 — Task 7·8이 이 시그니처를 유지한다.

- [ ] **Step 1: ProjectsPage.tsx 전체 교체**

```tsx
import { useState } from "react";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import { Folder } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";
import { projectsApi } from "./api";
import { useCreateProject, useDeleteProject, useProjects } from "./hooks";

interface ProjectsPageProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

function ProjectsPage({ sidebarOpen, onToggleSidebar }: ProjectsPageProps) {
  const { data: projects = [] } = useProjects();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const selected =
    projects.find((p) => p.slug === selectedSlug) ?? projects[0] ?? null;

  // Task 9에서 등록 다이얼로그로 교체된다
  const handleAdd = async () => {
    const folder = await open({ directory: true });
    if (typeof folder !== "string") return;
    try {
      const view = await createProject.mutateAsync(folder);
      setSelectedSlug(view.slug);
    } catch (e) {
      await message(`프로젝트를 추가하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  const handleRemove = async () => {
    if (!selected) return;
    const ok = await confirm(
      "코드 폴더는 삭제되지 않고 Atelier 목록에서만 제거됩니다.",
      { title: `'${selected.name}' 제거`, kind: "warning" },
    );
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(selected.slug);
      setSelectedSlug(null);
    } catch (e) {
      await message(`제거하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ProjectList
        projects={projects}
        selectedSlug={selected?.slug ?? null}
        onSelect={setSelectedSlug}
        onAdd={handleAdd}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Projects"
          leaf={selected?.name}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          actions={
            selected && (
              <>
                <button
                  type="button"
                  disabled={selected.missing}
                  onClick={() => projectsApi.openFolder(selected.slug)}
                  className="h-7 rounded-[9px] border border-border-strong bg-background px-[11px] text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                >
                  폴더 열기
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="h-7 rounded-[9px] px-[11px] text-[12.5px] font-medium text-red-600 transition-colors hover:bg-red-500/10"
                >
                  제거
                </button>
              </>
            )
          }
        />
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <ProjectDetail project={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <div className="flex max-w-[400px] flex-col items-center gap-[7px] text-center">
                <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                  <Folder className="size-5" strokeWidth={1.6} />
                </div>
                <span className="text-[15.5px] font-semibold tracking-[-0.01em]">
                  등록된 프로젝트가 없어요
                </span>
                <span className="text-[13px] leading-[1.65] text-tertiary">
                  로컬 저장소 폴더를 등록하면 원격과 브랜치를 자동 감지해요.
                </span>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="mt-3 h-8 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08]"
                >
                  프로젝트 등록
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default ProjectsPage;
```

- [ ] **Step 2: ProjectDetail.tsx에서 버튼·onDeleted 제거**

`src/features/projects/ProjectDetail.tsx`에서:
- `interface ProjectDetailProps`를 `{ project: ProjectView; }`로 축소하고 함수 시그니처를 `function ProjectDetail({ project }: ProjectDetailProps)`로 변경.
- `handleRemove` 함수, `useDeleteProject()` 호출, 상단 `<div className="flex items-center justify-between">…</div>` 블록(제목+버튼 2개)을 제거하고 `<h1 …>{project.name}</h1>`만 남긴다.
- 사용하지 않게 된 import 제거: `confirm`, `message`(`@tauri-apps/plugin-dialog` import 줄 전체), `projectsApi`, `useDeleteProject`.

- [ ] **Step 3: AppShell 임시 래퍼·SidebarToggle 제거**

`src/components/shell/AppShell.tsx`에서:
- `import SidebarToggle from "./SidebarToggle";` 삭제, 하단 `<SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />` 삭제, 최상위 div에서 `relative` 클래스 삭제.
- projects 분기를 다음으로 교체:

```tsx
        {activeKey === "projects" && (
          <ProjectsPage sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        )}
```

그리고 `rm src/components/shell/SidebarToggle.tsx`.

- [ ] **Step 4: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git status --short --branch
git add src/features/projects/ProjectsPage.tsx src/features/projects/ProjectDetail.tsx src/components/shell/AppShell.tsx src/components/shell/SidebarToggle.tsx
git commit -m "$(cat <<'EOF'
feat(fe): ProjectsPage 브레드크럼 도입 — 폴더 열기·제거 액션 이동

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 7: ProjectDetail 리스타일 — 배너·메타·설명

**Files:**
- Modify: `src/features/projects/ProjectDetail.tsx` (전면 교체)

**Interfaces:**
- Consumes: props `{ project: ProjectView }`(Task 6), 토큰(Task 1), `useUpdateProject`(기존).
- Produces: `BaseBranchControl({ project })` 내부 컴포넌트 — Task 8이 이 컴포넌트만 교체한다. `DescriptionEditor`의 편집 로직(Esc 취소, blur 커밋, `finished` ref 가드)은 기존과 동일해야 한다.

- [ ] **Step 1: ProjectDetail.tsx 전체 교체**

```tsx
import { useRef, useState } from "react";
import { Folder, GitBranch, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectDetailProps {
  project: ProjectView;
}

function ProjectDetail({ project }: ProjectDetailProps) {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-7 px-8 pb-12 pt-7">
      {project.missing && (
        <div className="flex items-center gap-2.5 rounded-[12px] border border-red-500 bg-red-500/[0.07] px-3.5 py-2.5">
          <span className="size-[7px] shrink-0 rounded-full bg-red-500" />
          <span className="shrink-0 text-[13px] font-medium text-red-600">
            경로를 찾을 수 없어요.
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나
            직접 제거하세요.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <h1 className="text-[21px] font-semibold tracking-[-0.01em]">{project.name}</h1>
        <dl className="mt-1 flex flex-col gap-px">
          <PropertyRow icon={<Folder className="size-3.5" strokeWidth={1.8} />} label="경로">
            <span
              className={cn(
                "truncate font-mono text-[12.5px] text-muted-foreground",
                project.missing && "text-red-600 line-through",
              )}
            >
              {project.path}
            </span>
          </PropertyRow>
          {project.git?.remoteSlug && (
            <PropertyRow icon={<GitMerge className="size-3.5" strokeWidth={1.8} />} label="원격">
              <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                {project.git.remoteSlug}
              </span>
            </PropertyRow>
          )}
          <PropertyRow icon={<GitBranch className="size-3.5" strokeWidth={1.8} />} label="baseBranch">
            <BaseBranchControl project={project} />
          </PropertyRow>
        </dl>
      </div>

      <DescriptionEditor key={project.slug} project={project} />
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[30px] items-center gap-3.5">
      <dt className="flex w-[108px] shrink-0 items-center gap-[9px] text-[12.5px] text-tertiary">
        {icon}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

// Task 8에서 팝오버 메뉴로 교체된다
function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const branches = project.git?.localBranches ?? [];
  if (branches.length === 0) {
    return <span className="font-mono text-[12.5px] text-muted-foreground">{project.baseBranch}</span>;
  }
  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];
  return (
    <select
      value={project.baseBranch}
      onChange={(e) =>
        updateProject.mutate({ slug: project.slug, patch: { baseBranch: e.target.value } })
      }
      className="rounded-[9px] border bg-transparent px-2 py-1 font-mono text-[12.5px]"
    >
      {options.map((branch) => (
        <option key={branch} value={branch}>
          {branch}
        </option>
      ))}
    </select>
  );
}

function DescriptionEditor({ project }: { project: ProjectView }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.description);
  const updateProject = useUpdateProject();
  // 키보드로 편집을 끝낸 뒤 언마운트 blur가 한 번 더 들어와도 무시하기 위한 가드
  const finished = useRef(false);

  const startEditing = () => {
    finished.current = false;
    setDraft(project.description);
    setEditing(true);
  };

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (commit && draft !== project.description) {
      updateProject.mutate({ slug: project.slug, patch: { description: draft } });
    } else if (!commit) {
      setDraft(project.description);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold text-muted-foreground">설명</h2>
        <span className="text-[11.5px] text-tertiary">클릭해서 편집</span>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) finish(true);
            if (e.key === "Escape") finish(false);
          }}
          rows={4}
          placeholder="이 프로젝트가 무엇인지, 왜 등록했는지 적어 주세요"
          className="min-h-[72px] resize-y rounded-[12px] border border-primary bg-background px-3.5 py-3 text-[13.5px] leading-[1.65] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-h-[72px] rounded-[12px] border px-3.5 py-3 text-left text-[13.5px] leading-[1.65] transition-colors hover:border-border-strong hover:bg-panel",
            !project.description && "italic text-tertiary",
          )}
        >
          {project.description || "아직 설명이 없어요. 이 프로젝트가 무엇인지 적어 주세요."}
        </button>
      )}
    </div>
  );
}

export default ProjectDetail;
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git status --short --branch
git add src/features/projects/ProjectDetail.tsx
git commit -m "$(cat <<'EOF'
feat(fe): ProjectDetail 리스타일 — 누락 배너·메타 행·설명 박스

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 8: baseBranch 팝오버 메뉴

**Files:**
- Modify: `src/features/projects/ProjectDetail.tsx` (`BaseBranchControl`만 교체 + import 추가)

**Interfaces:**
- Consumes: Task 7의 `BaseBranchControl` 자리, `useUpdateProject`.
- Produces: 브랜치 있으면 팝오버 메뉴, 없으면 클릭-편집 인라인 input. 외부 시그니처 `BaseBranchControl({ project })` 불변.

- [ ] **Step 1: BaseBranchControl 교체**

`ProjectDetail.tsx`의 import에 추가: `useEffect`(react), `Check`, `ChevronDown`(lucide-react). 기존 `BaseBranchControl` 함수(주석 포함)를 다음 두 함수로 교체:

```tsx
function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [open, setOpen] = useState(false);
  const branches = project.git?.localBranches ?? [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (branches.length === 0) {
    return <InlineBranchEditor key={project.slug} project={project} />;
  }

  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];

  return (
    <div className="relative -ml-[7px] flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="브랜치 목록에서 변경"
        className="flex h-[26px] items-center gap-1.5 rounded-[9px] px-[7px] font-mono text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {project.baseBranch}
        <ChevronDown className="size-2.5" strokeWidth={2.2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[30px] z-40 w-[248px] overflow-hidden rounded-[13px] border border-border-strong bg-background shadow-lg">
            <div className="flex h-8 items-center justify-between border-b px-3">
              <span className="text-[11.5px] font-semibold text-muted-foreground">브랜치</span>
              <span className="text-[11px] text-tertiary">{options.length}개</span>
            </div>
            <div className="flex flex-col gap-px p-[5px]">
              {options.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (branch !== project.baseBranch) {
                      updateProject.mutate({ slug: project.slug, patch: { baseBranch: branch } });
                    }
                  }}
                  className="flex h-[30px] w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {branch}
                  </span>
                  {branch === project.baseBranch && (
                    <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                  )}
                </button>
              ))}
            </div>
            <div className="border-t px-3 py-2 text-[11px] leading-normal text-tertiary">
              baseBranch 설정만 바꿔요 — checkout은 하지 않아요
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// git 브랜치 정보가 없을 때 — 클릭해서 직접 편집
function InlineBranchEditor({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.baseBranch);
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== project.baseBranch) {
      updateProject.mutate({ slug: project.slug, patch: { baseBranch: value } });
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="클릭해서 편집"
        onClick={() => {
          finished.current = false;
          setDraft(project.baseBranch);
          setEditing(true);
        }}
        className="-ml-[7px] flex h-[26px] items-center rounded-[9px] px-[7px] font-mono text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {project.baseBranch}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="h-[26px] w-[140px] rounded-[9px] border border-primary bg-background px-[7px] font-mono text-[12.5px] outline-none"
    />
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git status --short --branch
git add src/features/projects/ProjectDetail.tsx
git commit -m "$(cat <<'EOF'
feat(fe): baseBranch 팝오버 메뉴 + 브랜치 인라인 편집

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 9: 등록 다이얼로그

**Files:**
- Create: `src/features/projects/AddProjectDialog.tsx`
- Modify: `src/features/projects/ProjectsPage.tsx` (handleAdd → 다이얼로그)

**Interfaces:**
- Consumes: `useCreateProject`·`useUpdateProject`(기존 hooks), plugin-dialog `open`·`message`.
- Produces: `AddProjectDialog` props `{ open: boolean; onClose: () => void; onCreated: (slug: string) => void }` (default export). 등록 = `create(folder)` 후 baseBranch가 다르면 `update` 패치 (백엔드 변경 없음).

- [ ] **Step 1: AddProjectDialog.tsx 생성**

```tsx
import { useEffect, useState } from "react";
import { message, open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useCreateProject, useUpdateProject } from "./hooks";

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}

// open일 때만 마운트해서 열 때마다 입력 상태가 초기화되게 한다
function AddProjectDialog({ open, onClose, onCreated }: AddProjectDialogProps) {
  if (!open) return null;
  return <DialogBody onClose={onClose} onCreated={onCreated} />;
}

function DialogBody({ onClose, onCreated }: Omit<AddProjectDialogProps, "open">) {
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [folder, setFolder] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFolder = async () => {
    const picked = await openFolderPicker({ directory: true });
    if (typeof picked === "string") setFolder(picked);
  };

  const submit = async () => {
    if (!folder || submitting) return;
    setSubmitting(true);
    try {
      const view = await createProject.mutateAsync(folder);
      const branch = baseBranch.trim();
      if (branch && branch !== view.baseBranch) {
        await updateProject.mutateAsync({ slug: view.slug, patch: { baseBranch: branch } });
      }
      onCreated(view.slug);
      onClose();
    } catch (e) {
      setSubmitting(false);
      await message(`프로젝트를 추가하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(18,18,24,0.4)] pt-[120px]"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-[14px] border border-border-strong bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 px-5 pt-[18px]">
          <h2 className="text-[15px] font-semibold">프로젝트 등록</h2>
          <p className="text-[12.5px] text-tertiary">
            로컬 저장소 폴더를 Atelier에 연결해요. 코드는 건드리지 않아요.
          </p>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">폴더</span>
            {folder ? (
              <div className="flex items-center justify-between gap-2.5 rounded-[10px] border border-border-strong bg-inset px-3 py-2">
                <span className="truncate font-mono text-[12.5px]">{folder}</span>
                <button
                  type="button"
                  onClick={pickFolder}
                  className="h-6 shrink-0 rounded-[7px] border px-[9px] text-[11.5px] text-muted-foreground transition-colors hover:bg-accent"
                >
                  변경
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2.5 rounded-[12px] border border-dashed border-border-strong p-[18px]">
                <button
                  type="button"
                  onClick={pickFolder}
                  className="h-7 rounded-[9px] border border-border-strong bg-panel px-3 text-[12.5px] font-medium transition-colors hover:bg-accent"
                >
                  폴더 선택…
                </button>
                <span className="text-xs text-tertiary">네이티브 선택기가 열려요</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="add-base-branch">
              baseBranch
            </label>
            <input
              id="add-base-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="h-[30px] rounded-[9px] border border-border-strong bg-background px-2.5 font-mono text-[12.5px] outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[30px] rounded-[9px] border border-border-strong px-[13px] text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!folder || submitting}
            className="h-[30px] rounded-[9px] px-3.5 text-[12.5px] font-medium transition-[filter] enabled:bg-primary enabled:text-primary-foreground enabled:hover:brightness-[1.08] disabled:bg-accent disabled:text-tertiary"
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddProjectDialog;
```

- [ ] **Step 2: ProjectsPage에서 다이얼로그 연결**

`src/features/projects/ProjectsPage.tsx`에서:
- import 변경: `confirm, message` 만 남기고 `open` 제거 (`import { confirm, message } from "@tauri-apps/plugin-dialog";`), `useCreateProject` import 제거, `import AddProjectDialog from "./AddProjectDialog";` 추가.
- `const createProject = useCreateProject();` 제거, `const [dialogOpen, setDialogOpen] = useState(false);` 추가.
- `handleAdd` 함수(주석 포함)를 삭제하고 `const handleAdd = () => setDialogOpen(true);`로 교체.
- 최상위 JSX 마지막(`</main>` 다음, 바깥 `</div>` 직전)에 추가:

```tsx
      <AddProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={setSelectedSlug}
      />
```

- [ ] **Step 3: 빌드 확인**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git status --short --branch
git add src/features/projects/AddProjectDialog.tsx src/features/projects/ProjectsPage.tsx
git commit -m "$(cat <<'EOF'
feat(fe): 프로젝트 등록 다이얼로그 — 폴더 선택 + baseBranch 입력

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```

---

### Task 10: 통합 검증 — 빌드·회귀·GUI 스크린샷

**Files:**
- 없음 (검증 전용 — 발견된 결함만 수정)

**Interfaces:**
- Consumes: Task 1~9 전체.
- Produces: 검증 증거 (빌드 출력, 스크린샷 판독 결과).

- [ ] **Step 1: 정적 검증**

Run: `pnpm build && cargo test --workspace`
Expected: build PASS, 테스트 28/28 PASS (FE 전용 변경이므로 회귀 없음).

- [ ] **Step 2: 앱 실행 + 스모크 데이터**

Run: `pnpm tauri dev` (백그라운드, 포트 1420 — 고아 프로세스가 있으면 먼저 kill). 앱이 뜨면 이 리포(`/Users/gimhyoyeon/MyProjects/atelier`)를 등록 다이얼로그로 등록해 실데이터 1건을 만든다.
주의: `~/.atelier`는 실데이터 폴더 — Step 4에서 반드시 정리.

- [ ] **Step 3: 스크린샷 판독 체크리스트**

`screencapture -x <파일>`로 캡처 후 이미지 판독 (Tauri webview는 Playwright 불가). 각 항목을 목업(`docs/design/2026-07-19-atelier-specops-mockup.dc.html` — 브라우저로 열어 비교 가능)과 대조:

1. Rail 펼침(248px): 로고+Review/Projects/Works, 활성 항목 accent 틴트 radius 10.
2. ⌘B로 Rail 접힘(60px): 아이콘만, 신호등과 겹침 없음. 브레드크럼의 토글 버튼 동작.
3. Projects 목록: 304px 패널, 선택 행 selected-ring(accent 틴트+링), radius 12.
4. 상세: 21px 제목, 108px 라벨 메타 행, 12px 설명 박스, 브레드크럼 우측 "폴더 열기/제거".
5. baseBranch 팝오버: radius 13, 현재 브랜치 체크, 푸터 문구, Esc/바깥 클릭 닫힘.
6. 등록 다이얼로그: radius 14, 폴더 미선택 시 등록 비활성, 등록 성공 시 새 프로젝트 선택됨.
7. 목록 빈 상태(등록 전) + 상세 빈 상태.
8. ⌘1(Review 인박스 제로)·⌘3(Works 빈 상태) 화면.
9. 하단 상태바: `~/.atelier` + 감시 중.
10. 폰트: 라틴이 Geist, 한글이 Pretendard로 렌더 (경로는 Geist Mono).

- [ ] **Step 4: 정리**

앱 종료(dev 프로세스 kill), 스모크로 만든 `~/.atelier/projects/*.md` 삭제 (`~/.atelier` 비우기).

- [ ] **Step 5: 결함 수정 시 커밋**

체크리스트에서 결함을 발견해 수정했다면:

```bash
git status --short --branch
git add <수정 파일>
git commit -m "$(cat <<'EOF'
fix(fe): 디자인 개편 GUI 검증 후속 수정

KimHyoYeon
Claude-Session: https://claude.ai/code/session_01MQUzvWAWX5tw5SobxCgXn3
EOF
)"
```
