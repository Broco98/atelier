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
}

function ProjectsPage({ sidebarOpen }: ProjectsPageProps) {
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
