import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { Folder } from "lucide-react";
import ListPanelToggle, { useListPanel } from "@/components/shell/ListPanelToggle";
import PageHeader from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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

function ProjectsPage({ sidebarOpen, selectedSlug, onSelect, onOpenWork }: ProjectsPageProps) {
  // 이 화면은 `/projects` 주소에만 산다 — Maison 접두사가 붙을 수 없어 모드가 상수다
  // (결정 17: Maison에 프로젝트는 없다).
  const { data: projects = [] } = useProjects("atelier");
  // 목록 패널의 접힘과 ⌘Enter(본문을 넓히는 토글) — Archive와 같은 하나를 쓴다.
  const [panelOpen, togglePanel] = useListPanel("projects-panel-open");
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/projects.index.tsx)
  const selected = projects.find((p) => p.slug === selectedSlug) ?? null;

  // 네이티브 폴더 선택창 직행 — baseBranch는 백엔드가 감지하고 상세에서 바꿀 수 있다
  const handleAdd = async () => {
    if (createProject.isPending) return;
    const folder = await openFolderPicker({ directory: true });
    if (typeof folder !== "string") return;
    try {
      const view = await createProject.mutateAsync(folder);
      onSelect(view.slug);
    } catch (e) {
      await showProblem(`프로젝트를 추가하지 못했습니다: ${e}`);
    }
  };

  const handleRemove = async () => {
    if (!selected) return;
    const ok = await askDanger(
      `'${selected.name}' 제거`,
      "코드 폴더는 삭제되지 않고 Atelier 목록에서만 제거됩니다.",
      "제거",
    );
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(selected.slug);
      onSelect(null);
    } catch (e) {
      await showProblem(`제거하지 못했습니다: ${e}`);
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
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={selected.missing}
                    onClick={() => projectsApi.openFolder(selected.slug)}
                  >
                    폴더 열기
                  </Button>
                  <Button variant="destructive-ghost" size="sm" onClick={handleRemove}>
                    제거
                  </Button>
                </>
              )}
              <ListPanelToggle open={panelOpen} onToggle={togglePanel} />
            </>
          }
        />
        <div className="flex-1 overflow-y-auto scroll-quiet">
          {selected ? (
            <ProjectDetail project={selected} onOpenWork={onOpenWork} />
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Folder strokeWidth={1.6} />
                  </EmptyMedia>
                  <EmptyTitle>등록된 프로젝트가 없어요</EmptyTitle>
                  <EmptyDescription>
                    로컬 저장소 폴더를 등록하면 원격과 브랜치를 자동 감지해요.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={handleAdd}>프로젝트 등록</Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default ProjectsPage;
