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
