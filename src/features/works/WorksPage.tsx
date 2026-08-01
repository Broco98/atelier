import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Folder, List, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useProjects } from "@/features/projects/hooks";
import SpecViewer from "./SpecViewer";
import { useSetWorkStatus, useSetWorkTitle, useWorks } from "./hooks";
import { STATUS_META } from "./status";
import type { WorkStatus, WorkView } from "./types";

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  onOpenProject: (slug: string) => void;
}

function WorksPage({ sidebarOpen, selectedSlug, onOpenProject }: WorksPageProps) {
  const { data: works = [] } = useWorks();
  // 앱을 처음 켠 사람이 가장 먼저 보는 화면이 여기다. 프로젝트가 하나도 없으면
  // "새 작업을 시켜라"는 안내를 그대로 따라 해도 실패한다 — 그때는 등록으로 유도한다.
  const { data: projects = [] } = useProjects();
  const needsProject = works.length === 0 && projects.length === 0;
  // 목업 2026-07-19 개정: [소스]·작업 패널 토글은 브레드크럼 소유
  const [showSource, setShowSource] = useState(false);
  const [workPanelOpen, setWorkPanelOpen] = useState(true);

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널이 물려받는다.
  // 입력 중에는 무시.
  useEffect(() => {
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
  }, []);

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // "기본 선택은 초안을 건너뛴다"는 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Works"
          leaf={selected && <TitleEditor key={selected.slug} work={selected} />}
          // 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 본문이 창 왼쪽 끝에 붙는다
          inset={!sidebarOpen}
          meta={
            selected && (
              <span className="ml-1.5 flex shrink-0 items-center gap-2">
                <StatusMenu work={selected} />
                <span className="flex gap-1.5">
                  {selected.projects.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onOpenProject(p)}
                      title="프로젝트 상세로 이동"
                      className="rounded-[7px] bg-accent px-2 py-[3px] text-[12px] text-muted-foreground transition-colors hover:bg-inset hover:text-foreground"
                    >
                      {p}
                    </button>
                  ))}
                </span>
              </span>
            )
          }
          actions={
            <>
              {selected && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSource((v) => !v)}
                    className={cn(
                      "h-6 rounded-[8px] px-[9px] text-[12.5px] transition-colors",
                      showSource
                        ? "toggle-on"
                        : "text-tertiary hover:bg-state-2 hover:text-foreground",
                    )}
                  >
                    소스
                  </button>
                  {/* 이 화면의 유일한 접이식이다 — 본문 확대 단축키(⌘Enter)도 여기로 온다 */}
                  <button
                    type="button"
                    onClick={() => setWorkPanelOpen((v) => !v)}
                    aria-label="작업 패널 토글"
                    aria-expanded={workPanelOpen}
                    title={workPanelOpen ? "작업 패널 접기" : "작업 패널 펼치기"}
                    className={cn(
                      "icon-button transition-colors",
                      workPanelOpen
                        ? "toggle-on"
                        : "text-tertiary hover:bg-state-2 hover:text-foreground",
                    )}
                  >
                    <List className="size-3.5" strokeWidth={2} />
                  </button>
                </span>
              )}
            </>
          }
        />
        {selected ? (
          <SpecViewer
            key={selected.slug}
            work={selected}
            showSource={showSource}
            panelOpen={workPanelOpen}
          />
        ) : (
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
        )}
      </main>
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
        className="max-w-full truncate rounded-[7px] px-1.5 py-0.5 text-left transition-colors hover:bg-accent"
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
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-accent"
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

export default WorksPage;
