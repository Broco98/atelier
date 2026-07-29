import { useEffect, useState } from "react";
import { Folder, GitFork, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth, { ResizeHandle } from "@/components/shell/useResizableWidth";
import type { ProjectView } from "./types";

interface ProjectListProps {
  projects: ProjectView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onAdd: () => void;
  sidebarOpen: boolean;
  open: boolean;
}

function ProjectList({ projects, selectedSlug, onSelect, onAdd, sidebarOpen, open }: ProjectListProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) =>
        [p.name, p.path, p.git?.remoteSlug ?? ""].some((s) => s.toLowerCase().includes(q)),
      )
    : projects;

  const size = useResizableWidth("panel-width", 360, 280, 560);

  // Cmd+1~9 — 표시 순서(검색 반영) 기준 N번째 프로젝트 선택. 입력 중에는 무시.
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
      const project = filtered[Number(e.key) - 1];
      if (!project) return;
      e.preventDefault();
      onSelect(project.slug);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, onSelect]);

  return (
    // Sidebar와 같은 접힘 패턴 — 바깥은 폭 애니메이션, 안쪽은 고정 폭으로 리플로 방지
    <div
      style={{ "--panel-width": `${size.width}px` } as React.CSSProperties}
      className={cn(
        // 흰 바닥 — WorkList와 같은 이유다 (무채색 선택 표시가 묻히지 않게)
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
      {/* 타이틀바 스트립을 겸하는 패널 헤더 — 사이드바 닫힘 시 신호등·토글을 피해 좌측 패딩을 넓힌다 */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-(--titlebar-height) shrink-0 items-center justify-between pr-0.5 transition-[padding] duration-[220ms]",
          sidebarOpen ? "pl-0.5" : "pl-[114px]",
        )}
      >
        <button
          type="button"
          onClick={onAdd}
          aria-label="프로젝트 등록"
          title="프로젝트 등록"
          className="icon-button text-tertiary transition-colors hover:bg-state-2 hover:text-foreground"
        >
          <Plus className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {/* mb-[10px] = 헤더 행(44px)에서 24px 아이콘 버튼을 뺀 상하 여백 — 위아래 갭을 맞춘다 */}
      {projects.length > 0 && (
        <div className="relative mb-[10px] shrink-0">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary"
            strokeWidth={1.8}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트 검색"
            className="h-9 w-full rounded-full border bg-background pl-9 pr-3.5 text-[13.5px] outline-none placeholder:text-tertiary focus:border-primary"
          />
        </div>
      )}

      {projects.length === 0 ? (
        <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
          <Folder className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
          <span className="text-[13.5px] font-medium text-muted-foreground">프로젝트가 없어요</span>
          <span className="text-[12.5px] leading-normal text-tertiary">
            로컬 저장소 폴더를 등록해 시작하세요.
          </span>
          <button
            type="button"
            onClick={onAdd}
            className="mt-1.5 h-7 rounded-[9px] bg-primary/10 px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            프로젝트 등록
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pb-10">
          <span className="text-[13px] text-tertiary">검색 결과가 없어요</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto pb-2 scroll-quiet">
          {filtered.map((project) => {
            const active = project.slug === selectedSlug;
            return (
              <button
                key={project.slug}
                type="button"
                onClick={() => onSelect(project.slug)}
                className={cn(
                  // 테두리 없는 평평한 행 — 패널이 흰색이 된 뒤 흰 카드는 테두리만 남아 어긋난다.
                  // 규격(반지름·패딩·줄 간격)은 작업 목록과 같은 값이다 — 다른 것은 줄 수뿐
                  "flex w-full shrink-0 flex-col gap-[5px] rounded-[12px] px-3 py-1 text-left transition-colors",
                  active ? "selected-row" : "hover:bg-state-1",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      "min-w-0 truncate text-[13.5px] font-medium",
                      project.missing && "text-muted-foreground line-through",
                    )}
                  >
                    {project.name}
                  </span>
                  {project.missing && (
                    <span className="shrink-0 rounded-[7px] bg-red-500/10 px-2 py-0.5 text-[12px] font-medium text-red-600">
                      누락
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 font-mono text-[11.5px] text-tertiary">
                  <Folder className="size-3.5 shrink-0" strokeWidth={1.7} />
                  <span className="truncate">{project.path}</span>
                </span>
                {project.git?.remoteSlug && (
                  <span className="flex items-center gap-2 font-mono text-[11.5px] text-tertiary">
                    <GitFork className="size-3.5 shrink-0" strokeWidth={1.7} />
                    <span className="truncate">{project.git.remoteSlug}</span>
                    <span className="shrink-0 rounded-[6px] bg-accent px-[7px] py-px text-[11px]">
                      {project.baseBranch}
                    </span>
                  </span>
                )}
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

export default ProjectList;
