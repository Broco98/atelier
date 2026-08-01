import { useEffect, useState } from "react";
import { confirm, message, open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { Folder, Maximize2, Minimize2 } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";
import { projectsApi } from "./api";
import { useCreateProject, useDeleteProject, useProjects } from "./hooks";

interface ProjectsPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  onOpenWork: (slug: string | null) => void;
}

const PANEL_OPEN_KEY = "projects-panel-open";

function ProjectsPage({ sidebarOpen, selectedSlug, onSelect, onOpenWork }: ProjectsPageProps) {
  const { data: projects = [] } = useProjects();
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem(PANEL_OPEN_KEY) !== "0",
  );
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

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

  const selected =
    projects.find((p) => p.slug === selectedSlug) ?? projects[0] ?? null;

  // 네이티브 폴더 선택창 직행 — baseBranch는 백엔드가 감지하고 상세에서 바꿀 수 있다
  const handleAdd = async () => {
    if (createProject.isPending) return;
    const folder = await openFolderPicker({ directory: true });
    if (typeof folder !== "string") return;
    try {
      const view = await createProject.mutateAsync(folder);
      onSelect(view.slug);
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
      onSelect(null);
    } catch (e) {
      await message(`제거하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ProjectList
        projects={projects}
        selectedSlug={selected?.slug ?? null}
        onSelect={onSelect}
        sidebarOpen={sidebarOpen}
        onAdd={handleAdd}
        open={panelOpen}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Projects"
          leaf={selected?.name}
          inset={!sidebarOpen && !panelOpen}
          actions={
            <>
              {selected && (
                <>
                  <button
                    type="button"
                    disabled={selected.missing}
                    onClick={() => projectsApi.openFolder(selected.slug)}
                    // disabled:pointer-events-none — 테두리를 걷어낸 뒤로는 배경 농도가 "누를 수 있다"를
                    // 말하는 유일한 어휘라서, 비활성 상태에서 hover가 걸리면 눌리는 버튼으로 읽힌다
                    className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-state-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    폴더 열기
                  </button>
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-red-600 transition-colors hover:bg-red-500/10"
                  >
                    제거
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPanelOpen((open) => !open)}
                aria-label="목록 패널 토글"
                aria-expanded={panelOpen}
                title={panelOpen ? "목록 패널 접기" : "목록 패널 펼치기"}
                className="icon-button text-tertiary transition-colors hover:bg-state-2 hover:text-foreground"
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
        <div className="flex-1 overflow-y-auto scroll-quiet">
          {selected ? (
            <ProjectDetail project={selected} onOpenWork={onOpenWork} />
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <div className="flex max-w-[400px] flex-col items-center gap-[7px] text-center">
                <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                  <Folder className="size-5" strokeWidth={1.6} />
                </div>
                <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                  등록된 프로젝트가 없어요
                </span>
                <span className="text-[14px] leading-[1.65] text-tertiary">
                  로컬 저장소 폴더를 등록하면 원격과 브랜치를 자동 감지해요.
                </span>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="mt-3 h-8 rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08]"
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
