import { useState } from "react";
import { Folder, GitFork, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectView } from "./types";

interface ProjectListProps {
  projects: ProjectView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onAdd: () => void;
  sidebarOpen: boolean;
}

function ProjectList({ projects, selectedSlug, onSelect, onAdd, sidebarOpen }: ProjectListProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) =>
        [p.name, p.path, p.git?.remoteSlug ?? ""].some((s) => s.toLowerCase().includes(q)),
      )
    : projects;

  return (
    <div className="flex w-[360px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
      {/* 타이틀바 스트립을 겸하는 패널 헤더 — 사이드바 닫힘 시 신호등·토글을 피해 좌측 패딩을 넓힌다 */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-(--titlebar-height) shrink-0 items-center justify-between pr-0.5 transition-[padding] duration-[220ms]",
          sidebarOpen ? "pl-0.5" : "pl-[114px]",
        )}
      >
        <span className="flex items-baseline gap-[7px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Projects</span>
          <span className="text-[12.5px] text-tertiary">{projects.length}</span>
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

      {/* mb-[9px] = 헤더 행(44px)에서 26px 콘텐츠를 뺀 상하 여백 — 위아래 갭을 맞춘다 */}
      {projects.length > 0 && (
        <div className="relative mb-[9px] shrink-0">
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
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-2">
          {filtered.map((project) => {
            const active = project.slug === selectedSlug;
            return (
              <button
                key={project.slug}
                type="button"
                onClick={() => onSelect(project.slug)}
                className={cn(
                  "flex w-full shrink-0 flex-col gap-[7px] rounded-[14px] border px-4 py-3.5 text-left transition-colors",
                  active
                    ? "border-transparent selected-ring"
                    : "bg-background hover:bg-accent",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      "min-w-0 truncate text-[14.5px] font-semibold tracking-[-0.01em]",
                      active && "text-primary",
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
  );
}

export default ProjectList;
