import { useEffect, useRef, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { useStore } from "@tanstack/react-store";
import {
  Archive,
  Check,
  ChevronDown,
  File,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  PanelRight,
  SquareTerminal,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useProjects } from "@/features/projects/hooks";
import TerminalPane from "@/features/terminal/TerminalPane";
import { runningShellsOf } from "@/features/terminal/shell-registry";
import { closeShellsOf, terminalStore } from "@/features/terminal/terminal-store";
import type { ViewTab } from "@/routes/-work-search";
import SpecViewer from "./SpecViewer";
import WorkPanel from "./WorkPanel";
import WorkMetaMenu from "./WorkMetaMenu";
import {
  useArchiveWork,
  useRemoveWork,
  useSetWorkStatus,
  useSetWorkTitle,
  useWorks,
} from "./hooks";
import { STATUS_META } from "./status";
import type { WorkStatus, WorkView } from "./types";

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서와 그것을 옮기는 길. 둘 다 주소가 정본이라 여기서 소유하지 않는다.
  // `push`는 히스토리 항목을 만들지 여부다 — 트리는 만들지 않고 문서 링크는 만든다.
  currentFile: string | null;
  onSelectFile: (path: string, push: boolean) => void;
  onOpenProject: (slug: string) => void;
  // 보고 있는 화면 탭도 주소가 정본이다 — `currentFile`과 같은 결이다.
  tab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
}

function WorksPage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelectFile,
  onOpenProject,
  tab,
  onSelectTab,
}: WorksPageProps) {
  const { data: works = [] } = useWorks();
  // 앱을 처음 켠 사람이 가장 먼저 보는 화면이 여기다. 프로젝트가 하나도 없으면
  // "새 작업을 시켜라"는 안내를 그대로 따라 해도 실패한다 — 그때는 등록으로 유도한다.
  //
  // isPending을 함께 보는 이유: 이 화면이 앱의 첫 화면이 되면서 프로젝트 목록을 처음 읽는
  // 자리도 여기가 됐다. 길이만 보면 "아직 안 왔다"를 "하나도 없다"로 읽어, 이미 등록해 둔
  // 사람에게 매 실행마다 등록하라는 안내가 한 프레임 스친다.
  const { data: projects = [], isPending: projectsPending } = useProjects();
  const needsProject = !projectsPending && works.length === 0 && projects.length === 0;

  // 생애주기 조작은 ⋯ 메뉴가 부르지만 **상태는 여기서 소유한다** — 진행 표시가 메뉴 하나가
  // 아니라 본문 전체를 덮기 때문이다. 메뉴 안에 두면 그 표시를 메뉴 크기 안에서만 할 수 있다.
  const archive = useArchiveWork();
  const remove = useRemoveWork();
  const running = archive.isPending
    ? { verb: "아카이빙", detail: "워크트리를 정리하고 있어요" }
    : remove.isPending
      ? { verb: "삭제", detail: "워크트리와 스펙 문서를 지우고 있어요" }
      : null;
  // 브레드크럼이 소유하는 것은 작업 패널 접기 하나다. [소스]는 그 패널 머리행으로 갔고
  // 상태도 함께 SpecViewer로 내려갔다 — 버튼이 여기 없으면 이 화면이 그것을 들 이유도
  // 없다 (결정 6·22).
  const [workPanelOpen, setWorkPanelOpen] = useState(true);

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널이 물려받는다.
  // 입력 중에는 무시.
  // 터미널 탭에서는 **아무 일도 안 한다.** 한때 이유는 「그 탭에 패널이 없다」였는데 결정 35가
  // 패널을 되살리며 그 이유는 사라졌다. 그래도 그대로 두는 것은 결정 35가 **여는 길을 버튼
  // 하나로 두기로** 했기 때문이다 — 터미널에 포커스가 있으면 ⌘가 셸로 가는 결정 29와도
  // 맞는다. **비대칭은 남는다**: 포커스가 트리에 있어도 이 탭에서는 안 듣는다. 알려진 것으로
  // 티켓 06에 적어 뒀다.
  // `workPanelOpen` 값 자체는 건드리지 않는다 — spec으로 돌아오면 접어 뒀던 그대로여야 한다.
  useEffect(() => {
    if (tab === "terminal") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      setWorkPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // "기본 선택은 초안을 건너뛴다"는 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

  // **마지막으로 고른 작업을 붙들고 있는다.** 목록이 한 프레임이라도 이 작업을 잃으면
  // (조회가 흔들리거나 갱신 사이에 낀 렌더) 아래 터미널 가지가 통째로 언마운트되고, 다시
  // 마운트될 때 진입 이펙트가 「없으면 하나 띄운다」를 또 돈다 — `×`로 비워 둔 줄에 셸이
  // 저절로 돌아와, 판 02가 못박은 「마지막 칸을 닫으면 새 셸이 저절로 뜨지 않는다」가 깨진다
  // (실물에서 한 번 봤고 재현은 못 했다. 경로는 코드에서 읽힌다).
  //
  // 진짜로 사라진 경우에 붙들려 있지 않다: 그때는 주소 정규화가 다른 작업으로 옮기고
  // `tab`은 따라오지 않으므로 이 가지가 곧 닫힌다. spec 가지는 붙들지 않는다 — 거기서는
  // 다시 마운트돼도 문서를 다시 읽을 뿐 프로세스가 생기지 않는다.
  const lastSelected = useRef(selected);
  if (selected) lastSelected.current = selected;
  const terminalWork = tab === "terminal" ? (selected ?? lastSelected.current) : null;

  // 머리행은 **본문 열 안에서만** 산다. 작업 패널이 이 열의 형제이자 머리행과 같은 층이라
  // (창 맨 위에서 시작해 아래까지 내려온다) 머리행이 그 위를 지나갈 수 없다. 그래서 화면이
  // 여기서 만들어 두고, 작업이 골라졌으면 SpecViewer에 슬롯으로 넘긴다.
  const header = (
        <PageHeader
          root="Works"
          leaf={selected && <TitleEditor key={selected.slug} work={selected} />}
          // 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 본문이 창 왼쪽 끝에 붙는다
          inset={!sidebarOpen}
          // 브레드크럼에는 **작업 그 자체를 말하는 것**만 온다 — 제목 · ⓘ(메타) · ⋯(생애주기).
          // 셋이 붙어 한 덩어리로 읽혀야 "이것이 무슨 작업인가"가 한 번에 잡힌다.
          // 상태 배지는 오른쪽 actions로 갔다: 그것은 신원이 아니라 지금 어느 단계인가다.
          //
          // -ml-1은 PageHeader의 gap-1.5(6px)를 2px로 물린 것이다. 제목과 ⓘ 사이만
          // 좁히려는 것이고, 아이콘 버튼 둘은 서로 붙는다 (24px 상자 안에 여백이 이미 있다).
          meta={
            selected && (
              <span className="-ml-1 flex shrink-0 items-center">
                <WorkMetaMenu work={selected} />
                <WorkMenu work={selected} archive={archive} remove={remove} />
              </span>
            )
          }
          // 우측은 **지금 이 작업이 어느 단계이고 무엇을 보고 있는가**다. 상태 배지가
          // 여기 남는 이유는 자주 누르는 조작이라서다 — 탭이나 메뉴 뒤에 숨기면 상태를
          // 바꾸는 데 클릭이 두 번 든다.
          //
          // 여는 길은 PanelRight 하나, 닫는 길은 패널 안 × 하나다. 늘 보이는 토글로 두면 닫는
          // 길이 둘이 된다. 본문 확대 단축키(⌘Enter)는 양쪽을 겸한다.
          //
          // 닫혀 있을 때만 그리는 것으로 "닫기 애니메이션이 시작할 때 함께 뜬다"가
          // 따라온다 — workPanelOpen이 먼저 뒤집히고 패널 폭이 220ms 동안 줄어든다.
          // 트랜지션이 끝난 뒤에 띄우면 빈 자리를 그만큼 쳐다보게 된다.
          //
          // 글리프는 PanelRight다. List는 이 패널이 "작업 목록"이던 시절의 이름인데,
          // 정보 탭이 생기면 더는 목록이 아니다.
          actions={
            selected && (
              <>
                <StatusMenu work={selected} />
                <ViewTabs tab={tab} onSelect={onSelectTab} />
                {/* 두 탭 **모두**에 그린다. 한때 터미널 탭에서 뺐던 것은 그때 패널이
                    거기 없었기 때문이고(결정 11), 그 이유는 #100이 머지되며 사라졌다.
                    지금은 양쪽 다 패널을 이고 있으므로 누르면 실제로 열린다. */}
                {!workPanelOpen && (
                  <button
                    type="button"
                    onClick={() => setWorkPanelOpen(true)}
                    aria-label="작업 패널 펼치기"
                    aria-expanded={false}
                    title="작업 패널 펼치기"
                    className="icon-button-quiet text-tertiary"
                  >
                    <PanelRight className="size-4" strokeWidth={2} />
                  </button>
                )}
              </>
            )
          }
        />
  );

  return (
    // relative는 생애주기 오버레이가 이 영역 전체를 덮기 위한 것이다 — 패널까지 포함한다.
    // 보관·제거가 도는 동안 패널만 살아 있으면 그 위에서 조작이 계속된다.
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {terminalWork ? (
        // `key`는 Work마다 다시 마운트시킨다: 셸은 스토어가 들고 있어 안 죽고, 다시 붙는
        // 자리만 새로 잡힌다(결정 20·21).
        <>
          <main className="relative flex min-w-0 flex-1 flex-col">
            {header}
            <TerminalPane key={terminalWork.slug} work={terminalWork} />
          </main>
          {/* SpecViewer가 그리는 것과 **같은 패널**이다. 호출부가 둘인 것은 두 본문이
              형제 컬럼이라서다 — 패널을 여기로 끌어올리려면 SpecViewer가 들고 있는
              문서·소스토글·토스트까지 함께 올라와야 한다. 그 정리는 패널이
              `spec|세션|정보`가 되는 다음 판의 몫이다.

              트리에서 파일을 누르면 **spec으로 돌아가며** 그 문서가 열린다. `selectFile`이
              search를 객체로 갈아 끼워 `tab`이 함께 떨어지기 때문이다(결정 15의 뒷면).
              그 성질이 여기서 처음으로 눈에 보이는 일을 하므로 router.test.ts에 못박았다.
              래퍼를 두지 않는 것은 이동이 **한 번**이어야 해서다 — 탭과 파일을 따로 옮기면
              두 navigate가 한 틱에 겹친다. */}
          <WorkPanel
            work={terminalWork}
            currentFile={currentFile}
            onSelectFile={(path) => onSelectFile(path, false)}
            onCopy={(text) => void navigator.clipboard.writeText(text)}
            onClose={() => setWorkPanelOpen(false)}
            onOpenProject={onOpenProject}
            // 본문이 문서가 아니라 셸이다. `</>`가 적용될 곳이 없으므로 잠근다 — 눌러도
            // 아무 일이 없는 버튼을 만들지 않는다(결정 11·21).
            sourceOn={false}
            sourceLocked
            onToggleSource={() => {}}
            open={workPanelOpen}
          />
        </>
      ) : selected ? (
        <SpecViewer
          key={selected.slug}
          work={selected}
          header={header}
          panelOpen={workPanelOpen}
          onClosePanel={() => setWorkPanelOpen(false)}
          onOpenProject={onOpenProject}
          sidebarOpen={sidebarOpen}
          file={currentFile}
          onSelectFile={onSelectFile}
        />
      ) : (
        // 고른 작업이 없으면 패널도 없다 — 이 열이 머리행을 직접 이고 있는다.
        <main className="relative flex min-w-0 flex-1 flex-col">
          {header}
          <div className="flex flex-1 items-center justify-center p-10">
            <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
              <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                {needsProject ? (
                  <Folder className="size-5" strokeWidth={1.6} />
                ) : (
                  <Zap className="size-5" strokeWidth={1.6} />
                )}
              </div>
              <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                {needsProject ? "먼저 프로젝트를 등록해요" : "아직 작업이 없어요"}
              </span>
              <span className="text-[14px] leading-[1.65] text-tertiary">
                {needsProject
                  ? "작업은 등록된 프로젝트 위에서 시작돼요. Projects에서 폴더를 고르거나, 에이전트에게 맡겨도 돼요."
                  : "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요."}
              </span>
              {/* 실제로 통하는 경로만 안내한다 — CLI에는 등록·시작 명령이 없고, 에이전트가
                  atelier_add_project / atelier_start_work를 부른다.
                  아래 문구는 그대로 붙여 넣는 것이다. */}
              <code className="mt-3 select-all rounded-[10px] border bg-inset px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
                {needsProject ? "atelier에 이 폴더 등록해줘" : 'atelier로 "새 작업" 시작해줘'}
              </code>
            </div>
          </div>
        </main>
      )}

      {running && <LifecycleOverlay verb={running.verb} detail={running.detail} />}
    </div>
  );
}

// 되돌릴 수 없는 조작이 도는 동안 본문을 덮는다.
//
// 워크트리 제거는 폴더 크기에 비례해 수 초가 걸린다(실측 8.9GB). 그동안 화면이 아무 말도
// 하지 않으면 **버튼이 안 눌린 것처럼 보이고**, 사이드바에는 그 작업이 아직 그대로 있어
// 더 그렇다. 덮는 것 자체도 목적이다 — 진행 중에 같은 작업을 다시 겨누지 못하게 한다.
//
// 헤더까지 덮는다. ⋯ 버튼이 거기 있고, 그것을 다시 누르는 것이 막아야 할 바로 그 동작이다.
// 사이드바는 덮지 않는다 — 이 조작은 본문이 보여주는 작업 하나에만 걸린다.
function LifecycleOverlay({ verb, detail }: { verb: string; detail: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-2">
        <LoaderCircle className="size-6 animate-spin text-primary" strokeWidth={2} />
        <span className="mt-1 text-[15px] font-semibold tracking-[-0.01em]">{verb} 중…</span>
        <span className="text-[13px] text-tertiary">{detail}</span>
      </div>
    </div>
  );
}

// 브레드크럼 말단 제목 인라인 편집 — slug는 바뀌지 않는다 (ProjectDetail의 TitleEditor와 같은 계약).
// 감싸는 PageHeader의 leaf span이 truncate/overflow:hidden이라 두 상태 모두 max-w-full로 스스로 줄어든다.
//
// ProjectDetail 쪽과 달리 **음수 마진을 쓰지 않는다.** 그쪽 부모는 평범한 h1이지만 여기 부모는
// 잘라내므로, 왼쪽으로 삐져나온 만큼이 그대로 클립된다 — outline-none이라 유일한 포커스 표시인
// 입력의 왼쪽 테두리가 사라진다. 대신 패딩만 쓰고 두 상태의 좌측 정렬을 서로 맞춘다.
function TitleEditor({ work }: { work: WorkView }) {
  const setTitle = useSetWorkTitle();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(work.title);
  // blur와 Enter가 함께 들어와 두 번 커밋되는 것을 막는다
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    // 재조회가 돌아오기 전에 편집 모드를 먼저 끝낸다 — draft가 새 값과 싸우지 않게
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== work.title) {
      setTitle.mutate({ slug: work.slug, title: value });
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="클릭해서 편집"
        onClick={() => {
          finished.current = false;
          setDraft(work.title);
          setEditing(true);
        }}
        className="max-w-full truncate rounded-[7px] px-1.5 py-0.5 text-left transition-colors hover:bg-state-2"
      >
        {work.title}
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
      className="w-full min-w-0 rounded-[7px] border border-primary bg-background px-1.5 py-0.5 text-[14px] font-medium outline-none"
    />
  );
}

// 브레드크럼 상태 배지 + 변경 드롭다운
/**
 * 왼쪽 본문이 **무엇을 보여주는가**를 고르는 묶음 — `spec`과 `터미널` 둘이다(결정 9).
 * `파일`(워크트리 탐색)은 재료도 문제도 다른 기능이라 별도 작업이다.
 *
 * 켜짐은 저장소 공통 toggle-on이다. 목업은 이 자리에 --accent를 쓰는데, 이 저장소는
 * 상태 배경을 무채색 4단으로만 말한다(state-scale.test.ts가 막는다) — 그쪽을 따르지 않는다.
 * 꺼진 칸의 hover가 `quiet-hover`(2)인 것은 이 줄이 **토글 묶음**이어서다: 셸 탭 줄이
 * `hover:bg-state-1`을 쓰는 것과 갈리는 자리이고, 근거는 index.css의 부등식이다.
 */
function ViewTabs({ tab, onSelect }: { tab: ViewTab; onSelect: (tab: ViewTab) => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <ViewTabButton icon={File} label="spec" on={tab === "spec"} onClick={() => onSelect("spec")} />
      <ViewTabButton
        icon={SquareTerminal}
        label="터미널"
        on={tab === "terminal"}
        onClick={() => onSelect("terminal")}
      />
    </span>
  );
}

function ViewTabButton({
  icon: Icon,
  label,
  on,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} 보기`}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-[7px] rounded-[9px] px-[11px] text-[13px] font-medium transition-colors",
        // hover는 **꺼진 가지 안에만** 둔다 — toggle-on이 자기 hover를 품으므로 함께 얹으면
        // 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고).
        on ? "toggle-on" : "text-tertiary quiet-hover",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
      {label}
    </button>
  );
}

function StatusMenu({ work }: { work: WorkView }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const setStatus = useSetWorkStatus();
  const meta = STATUS_META[work.status];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="상태 변경"
        className={cn(
          "flex h-[22px] items-center gap-1 rounded-[7px] px-2 text-[12px] font-medium transition-[filter] hover:brightness-95",
          meta.badgeClass,
        )}
      >
        {meta.label}
        <ChevronDown className="size-2.5" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {(Object.keys(STATUS_META) as WorkStatus[]).map((status) => {
              const option = STATUS_META[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (status !== work.status) {
                      setStatus.mutate({ slug: work.slug, status });
                    }
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
                >
                  <span className={cn("size-[7px] shrink-0 rounded-full", option.dotClass)} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {option.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-tertiary">{option.desc}</span>
                  {status === work.status && (
                    <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                  )}
                </button>
              );
            })}
        </PopoverPortal>
      )}
    </span>
  );
}

// 생애주기 조작 — 뷰 토글이 모인 우측 actions가 아니라 StatusMenu 옆에 산다.
// 둘 다 되돌릴 수 없어서 네이티브 확인을 거치고, 거절 사유(커밋 안 된 변경 등)는
// 코어가 파일 단위로 말해주므로 그대로 보여준다.
//
// 성공 뒤에 선택을 옮기지 않는다 — 목록 무효화로 이 작업이 사라지면 -works-view.tsx의
// 정규화(`exists`가 false가 되는 경로)가 주소까지 함께 옮긴다. 여기서 또 옮기면 같은 일을
// 두 곳이 하게 되고, 그쪽이 "사라진 작업" 일반을 이미 담당한다.
function WorkMenu({
  work,
  archive,
  remove,
}: {
  work: WorkView;
  // 상태를 위에서 받는다 — 진행 표시가 본문 전체를 덮으므로 소유자가 WorksPage다
  archive: ReturnType<typeof useArchiveWork>;
  remove: ReturnType<typeof useRemoveWork>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const busy = archive.isPending || remove.isPending;
  // 이 Work의 **살아 있는** 셸. 확인 대화가 그 수를 말한다(결정 26). 고르는 규칙은
  // `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다.
  //
  // 끝난 칸과 못 뜬 칸은 세지 않는다 — 그 칸들은 남아 있지만 죽일 프로세스가 없어서,
  // 함께 세면 "셸 2개가 닫혀요"라고 해놓고 실제로는 하나만 끝난다. **거두는 것은 그래도
  // 전부다**(아래): Work가 사라지는데 그 Work를 가리키는 칸만 남으면 닫을 길이 없다.
  const liveShells = useStore(terminalStore, (state) => runningShellsOf(state, work.slug));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 다른 작업으로 옮겨가면 닫는다 — 열어 둔 채 전환하면 메뉴가 살아남아 **화면에 보이는
  // 것과 다른 작업**을 겨눈다.
  //
  // **지금은 이 이펙트가 돌기 전에 리마운트가 먼저 닫는다.** 머리행이 key={slug}인
  // SpecViewer 안으로 들어가면서(디자인 정본 정렬) 작업을 옮기면 이 컴포넌트째 새로 선다.
  // 남겨 두는 것은 그 배치가 이 화면의 계약이 아니기 때문이다 — 머리행을 다시 SpecViewer
  // 밖으로 끌어내면(작업 패널을 WorksPage로 올리는 다음 판이 그렇게 한다) 리마운트가
  // 사라지고 이 줄만 남아 같은 일을 한다. 형제인 StatusMenu는 이 줄이 없어서, 지금은
  // 리마운트에만 기대고 있다.
  useEffect(() => setOpen(false), [work.slug]);

  // 진행 중에는 다시 부르지 않는다. 두 번째 호출은 이미 옮겨진 작업을 찾지 못해 실패하는데,
  // 성공한 아카이빙 위에 "아카이빙하지 못했습니다" 창이 뜨는 것이 그 결과다.
  const run = async (
    verb: string,
    detail: string,
    call: () => Promise<unknown>,
  ) => {
    setOpen(false);
    if (busy) return;
    // 셸은 이 Work의 워크트리에서 도는 프로세스라 폴더가 정리되면 함께 끝난다. 누르기 전에
    // 그 사실을 말한다 — 용어는 「셸」이다("터미널"은 화면을 가리키는 말이라 여기서 쓰면
    // 다른 것을 센 것처럼 읽힌다). 0개면 그 줄을 쓰지 않는다.
    const notice = liveShells > 0 ? `${detail}\n셸 ${liveShells}개가 닫혀요.` : detail;
    const ok = await confirm(notice, { title: `'${work.title}' ${verb}`, kind: "warning" });
    if (!ok) return;
    try {
      await call();
    } catch (e) {
      await message(`${verb}하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
      return;
    }
    // **성공한 뒤에** 거둔다(결정 26). 순서가 계약이다 — dirty 판정은 확인 대화가 아니라
    // 그 뒤 코어에서 나므로, 먼저 죽이면 거부당했을 때 **Work는 남고 돌던 claude만
    // 사라진다.** 터미널에서 claude를 돌리는 것 자체가 워크트리를 dirty로 만든다.
    closeShellsOf(work.slug);
  };

  // 문구는 실제로 남는 것과 사라지는 것을 **둘 다** 말한다. 아카이빙 쪽만 "보존"을 말하면
  // 대비로 인해 삭제가 커밋까지 지우는 것처럼 읽히고(브랜치는 양쪽 다 남는다), 워크트리
  // 제거가 gitignore된 파일(.env·로컬 DB·빌드 산출물)까지 가져간다는 사실은 **양쪽 다**
  // 적는다. 그 파일들은 dirty 검사에 잡히지 않으므로 이 문구가 유일한 경고이고, 둘 다
  // 같은 worktree_remove를 탄다 — 삭제 쪽은 스펙까지 지우니 더 잃는다.
  const handleArchive = () =>
    run(
      "아카이빙",
      "스펙과 기록은 남고 워크트리 폴더가 정리돼요. 브랜치와 커밋은 그대로예요.\n" +
        "다만 git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)은 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => archive.mutateAsync(work.slug),
    );

  const handleRemove = () =>
    run(
      "삭제",
      "워크트리 폴더와 스펙 문서가 모두 지워져요. 브랜치와 커밋은 남지만 기록은 안 남아요 —\n" +
        "남길 것이 있다면 아카이빙을 쓰세요.\n" +
        "git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)도 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => remove.mutateAsync(work.slug),
    );

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="작업 메뉴"
        aria-expanded={open}
        aria-busy={busy}
        title={busy ? "처리 중이에요" : "작업 메뉴"}
        // **icon-button 규격이다** — 바로 왼쪽 ⓘ와 맞붙어 서기 때문이다.
        // 둘 사이에 여백이 없어(위 meta의 -ml-1 묶음) hover 배경이 한 버튼에서 다음
        // 버튼으로 끊김 없이 옮겨가고, 그 순간 상자가 다르면 배경이 커졌다 작아진다.
        // 22px·radius 7은 옛 이웃이던 상태 배지에 맞춰 둔 값인데, 그 배지가 오른쪽
        // actions로 가면서 맞춰야 할 상대가 24px 아이콘 버튼으로 바뀌었다.
        // icon-button-quiet을 쓰지 않는 것은 켜짐이 있어서다 — quiet-hover는 꺼진 가지 안에만 둔다.
        className={cn(
          "icon-button transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          open ? "toggle-on" : "text-tertiary quiet-hover",
        )}
      >
        {/* 진행 표시는 여기가 아니라 본문을 덮는 LifecycleOverlay가 한다 — 14px 글리프의
            깜빡임은 워크트리 제거가 도는 수 초 동안 "눌리긴 했나"에 답하지 못했다.
            disabled는 그대로 둔다: 오버레이가 뜨기 전 한 프레임을 막는 것도 이 속성이다. */}
        <MoreHorizontal className="size-4" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          <button
            type="button"
            onClick={handleArchive}
            className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
          >
            <Archive className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">아카이빙</span>
          </button>
          <span className="my-[3px] h-px bg-border" />
          <button
            type="button"
            onClick={handleRemove}
            className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">삭제</span>
          </button>
        </PopoverPortal>
      )}
    </span>
  );
}

export default WorksPage;
