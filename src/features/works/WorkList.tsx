import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, ChevronDown, Filter, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { formatCreated, StatusIcon } from "./status";
import type { WorkView } from "./types";

interface WorkListProps {
  works: WorkView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  sidebarOpen: boolean;
  open: boolean;
}

function WorkList({ works, selectedSlug, onSelect, sidebarOpen, open }: WorkListProps) {
  const [sortAsc, setSortAsc] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);

  const projectOptions = [...new Set(works.flatMap((w) => w.projects))].sort();
  const filtered = projectFilter
    ? works.filter((w) => w.projects.includes(projectFilter))
    : works;
  // 백엔드 기본 정렬 = 생성일 내림차순·slug 오름차순 tiebreak.
  // 오름차순은 생성일만 뒤집고 tiebreak 방향은 유지한다 (reverse()는 tiebreak도 뒤집힘)
  const sorted = sortAsc
    ? [...filtered].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug),
      )
    : filtered;

  const size = useResizableWidth("panel-width", 360, 280, 560);

  // Cmd+1~9 — 표시 순서(정렬·필터 반영) 기준 N번째 작업 선택. 입력 중에는 무시.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || !/^[1-9]$/.test(e.key)) return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      const work = sorted[Number(e.key) - 1];
      if (!work) return;
      e.preventDefault();
      onSelect(work.slug);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sorted, onSelect]);

  return (
    <div
      style={{ "--panel-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        // 흰 바닥 — 무채색 선택 표시가 배경에 묻히지 않으려면 패널이 흰색이어야 한다.
        // --bg-panel 변수 자체는 그대로 둔다 (상태바·작업 패널 카드는 회색으로 남는다)
        "relative shrink-0 overflow-hidden border-r bg-background",
        // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다
        !size.dragging &&
          "transition-[width,border-color] duration-[220ms] ease-panel",
        open ? "w-(--panel-width)" : "w-0 border-transparent",
      )}
    >
      <div
        className={cn(
          "flex h-full w-(--panel-width) flex-col px-3 pb-3 transition-opacity",
          open ? "opacity-100 duration-[220ms]" : "opacity-0 duration-150",
        )}
      >
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-(--titlebar-height) shrink-0 items-center justify-between pr-0.5 transition-[padding] duration-[220ms]",
            sidebarOpen ? "pl-0.5" : "pl-[114px]",
          )}
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSortAsc((v) => !v)}
              title="생성일 기준 정렬"
              className="flex h-6 items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-muted-foreground transition-colors hover:bg-state-2 hover:text-foreground"
            >
              <ArrowDown
                className={cn("size-3 transition-transform", sortAsc && "rotate-180")}
                strokeWidth={2}
              />
              {/* 사이드바 닫힘 시 신호등 인셋(114px) 때문에 라벨을 접고 아이콘만 남긴다 */}
              {sidebarOpen && "생성일"}
            </button>
            <span className="relative flex min-w-0">
              <button
                ref={filterAnchor}
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                title={projectFilter ?? "모든 프로젝트"}
                className={cn(
                  "flex h-6 max-w-[120px] items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium transition-colors",
                  projectFilter
                    ? "toggle-on"
                    : "text-muted-foreground hover:bg-state-2 hover:text-foreground",
                )}
              >
                <Filter className="size-3 shrink-0" strokeWidth={2} />
                {sidebarOpen && (
                  <>
                    <span className="truncate">{projectFilter ?? "모든 프로젝트"}</span>
                    <ChevronDown className="size-2.5 shrink-0" strokeWidth={2.2} />
                  </>
                )}
              </button>
              {filterOpen && (
                <PopoverPortal
                  anchorRef={filterAnchor}
                  align="right"
                  width={200}
                  onClose={() => setFilterOpen(false)}
                  className="flex flex-col gap-px p-[5px]"
                >
                  {[null, ...projectOptions].map((option) => (
                    <button
                      key={option ?? "*"}
                      type="button"
                      onClick={() => {
                        setProjectFilter(option);
                        setFilterOpen(false);
                      }}
                      className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                        {option ?? "모든 프로젝트"}
                      </span>
                      {projectFilter === option && (
                        <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                      )}
                    </button>
                  ))}
                </PopoverPortal>
              )}
            </span>
          </span>
        </div>

        {works.length === 0 ? (
          <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
            <Zap className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
            <span className="text-[13.5px] font-medium text-muted-foreground">작업이 없어요</span>
            <span className="text-[12.5px] leading-normal text-tertiary">
              작업은 Claude Code에서 스킬로 시작돼요.
            </span>
            <code className="mt-1 select-all rounded-[9px] border bg-inset px-2 py-1.5 font-mono text-[11.5px] text-muted-foreground">
              atelier work start "새 작업" --project &lt;slug&gt;
            </code>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-1 items-center justify-center pb-10">
            <span className="text-[13px] text-tertiary">해당 프로젝트의 작업이 없어요</span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto pb-2 scroll-quiet">
            {sorted.map((work) => {
              const active = work.slug === selectedSlug;
              return (
                <button
                  key={work.slug}
                  type="button"
                  onClick={() => onSelect(work.slug)}
                  className={cn(
                    // 프로젝트 목록 항목과 공유하는 규격 — 반지름·패딩·줄 간격이 같고
                    // 두 목록의 차이는 줄 수(정보량)뿐이다
                    "flex w-full shrink-0 flex-col gap-[5px] rounded-[12px] px-3 py-1 text-left transition-colors",
                    active ? "selected-row" : "hover:bg-state-1",
                  )}
                >
                  <span className="flex items-center gap-[7px]">
                    <StatusIcon status={work.status} />
                    <span
                      className={cn(
                        "min-w-0 truncate text-[13.5px] font-medium",
                        work.status === "done" && "text-muted-foreground",
                      )}
                    >
                      {work.title}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 gap-1 overflow-hidden">
                      {work.projects.map((p) => (
                        <span
                          key={p}
                          className="shrink-0 rounded-[6px] bg-accent px-1.5 py-px text-[11px] text-muted-foreground"
                        >
                          {p}
                        </span>
                      ))}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-tertiary">
                      {formatCreated(work.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && <ResizeHandle control={size} />}
    </div>
  );
}

export default WorkList;
