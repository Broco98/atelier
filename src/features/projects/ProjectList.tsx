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
    <div className="flex w-[320px] shrink-0 flex-col border-r">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
          PROJECTS
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label="프로젝트 추가"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent"
        >
          <Plus className="size-4" strokeWidth={1.7} />
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            아직 프로젝트가 없어요.
            <br />
            코드 폴더를 추가해 시작하세요.
          </p>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-[7px] bg-sidebar-primary/12 px-3 py-1.5 text-[13px] font-medium text-sidebar-primary"
          >
            프로젝트 추가
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-2">
          {projects.map((project) => {
            const active = project.slug === selectedSlug;
            return (
              <button
                key={project.slug}
                type="button"
                onClick={() => onSelect(project.slug)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-[7px] px-[9px] py-2 text-left transition-colors",
                  active ? "bg-sidebar-primary/12" : "hover:bg-sidebar-accent",
                )}
              >
                <span className="flex items-center gap-[7px]">
                  <Folder className="size-[15px] shrink-0 text-muted-foreground" strokeWidth={1.7} />
                  <span
                    className={cn(
                      "truncate text-[13px] font-medium",
                      project.missing && "text-muted-foreground line-through",
                      active && !project.missing && "text-sidebar-primary",
                    )}
                  >
                    {project.name}
                  </span>
                  {project.missing && (
                    <span className="ml-auto rounded bg-red-500/10 px-1.5 text-[11px] font-medium text-red-500">
                      누락
                    </span>
                  )}
                </span>
                <span className="truncate pl-[22px] font-mono text-[11.5px] text-muted-foreground">
                  {project.path}
                </span>
                {project.git?.remoteSlug && (
                  <span className="flex items-center gap-1 truncate pl-[22px] font-mono text-[11.5px] text-muted-foreground">
                    <GitBranch className="size-[11px]" strokeWidth={1.7} />
                    {project.git.remoteSlug}
                    {project.git.currentBranch && (
                      <span className="rounded bg-sidebar-accent px-1">
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
