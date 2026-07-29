import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, List, Maximize2, Minimize2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import { PopoverPortal } from "@/components/ui/popover-portal";
import WorkList from "./WorkList";
import SpecViewer from "./SpecViewer";
import { useSetWorkStatus, useWorks } from "./hooks";
import { STATUS_META } from "./status";
import type { WorkStatus, WorkView } from "./types";

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  onOpenProject: (slug: string) => void;
}

const PANEL_OPEN_KEY = "works-panel-open";

function WorksPage({ sidebarOpen, selectedSlug, onSelect, onOpenProject }: WorksPageProps) {
  const { data: works = [] } = useWorks();
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem(PANEL_OPEN_KEY) !== "0",
  );
  // 목업 2026-07-19 개정: [소스]·작업 패널 토글은 브레드크럼 소유
  const [showSource, setShowSource] = useState(false);
  const [workPanelOpen, setWorkPanelOpen] = useState(true);

  useEffect(() => {
    localStorage.setItem(PANEL_OPEN_KEY, panelOpen ? "1" : "0");
  }, [panelOpen]);

  // Cmd+Enter — 목록 패널 접기/펼치기 (콘텐츠 확대·축소). 입력 중에는 무시.
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
      setPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selected = works.find((w) => w.slug === selectedSlug) ?? works[0] ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <WorkList
        works={works}
        selectedSlug={selected?.slug ?? null}
        onSelect={onSelect}
        sidebarOpen={sidebarOpen}
        open={panelOpen}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Works"
          leaf={selected?.title}
          inset={!sidebarOpen && !panelOpen}
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
                      "h-[26px] rounded-[9px] border px-[9px] text-[12.5px] transition-colors hover:bg-accent",
                      showSource ? "bg-accent text-foreground" : "text-tertiary",
                    )}
                  >
                    소스
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkPanelOpen((v) => !v)}
                    title={workPanelOpen ? "작업 패널 접기" : "작업 패널 펼치기"}
                    className={cn(
                      "flex size-[26px] items-center justify-center rounded-[9px] border transition-colors hover:bg-accent",
                      workPanelOpen ? "text-primary" : "text-tertiary",
                    )}
                  >
                    <List className="size-3.5" strokeWidth={2} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => setPanelOpen((open) => !open)}
                aria-label="목록 패널 토글"
                aria-expanded={panelOpen}
                title={panelOpen ? "목록 패널 접기" : "목록 패널 펼치기"}
                className="flex size-7 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {panelOpen ? (
                  <Maximize2 className="size-4" strokeWidth={1.7} />
                ) : (
                  <Minimize2 className="size-4" strokeWidth={1.7} />
                )}
              </button>
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
                <Zap className="size-5" strokeWidth={1.6} />
              </div>
              <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                아직 작업이 없어요
              </span>
              <span className="text-[14px] leading-[1.65] text-tertiary">
                작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행
                상황이 여기에 나타나요.
              </span>
              {/* 실제로 통하는 경로만 안내한다 — CLI에는 시작 명령이 없고, 에이전트가
                  atelier_start_work를 부른다. 아래 문구는 그대로 붙여 넣는 것이다. */}
              <code className="mt-3 select-all rounded-[10px] border bg-inset px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
                atelier로 "새 작업" 시작해줘
              </code>
            </div>
          </div>
        )}
      </main>
    </div>
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
