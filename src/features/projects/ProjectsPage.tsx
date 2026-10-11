import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { Folder, FolderOpen, Trash2 } from "lucide-react";
import { Card, CardHead, Frame } from "@/components/shell/Frame";
import ListPanelToggle, { useListPanel } from "@/components/shell/ListPanelToggle";
import { navItem } from "@/components/shell/nav-items";
import useResizableWidth from "@/components/shell/useResizableWidth";
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
  const { data: projects = [] } = useProjects();
  // 목록 패널의 접힘과 ⌘Enter(본문을 넓히는 토글) — Archive와 같은 하나를 쓴다.
  const [panelOpen, togglePanel] = useListPanel("projects-panel-open");
  // 목록 카드의 폭 — 이 목록만 쓰는 키다(사이드바는 `sidebar-width`, 아카이브 목록은 `archive-panel-width`를 따로 갖는다).
  const listSize = useResizableWidth("panel-width", 360, 280, 560);
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
    // 공용 틀 위의 목록 카드와 상세 카드(ui-refresh 결정 15 · 27). 머리 줄에는 고른 프로젝트의 머리 카드가 선다(codex-ds 스펙 §7).
    <Frame
      sidebarOpen={sidebarOpen}
      // 머리 카드 — 왼쪽은 폴더 아이콘과 고른 프로젝트의 이름(고른 것이 없으면 nav의 화면 이름)이다. 오른쪽은 그 프로젝트에 거는 할 일인
      // 폴더 열기 | 제거다(스토리 52). 제거는 되돌릴 수 없는 할 일이라 세로선 너머에 떼어 둔다(DS 캔버스). 캔버스의 「LLM이 받는
      // 텍스트」는 지금 앱에 없는 조작이라 짓지 않는다(codex-ds 스펙 S13). 이름은 보이기만 한다 — 제자리 이름 바꾸기는 codex-ds 티켓 28.
      head={{
        icon: Folder,
        name: selected?.name ?? navItem("projects").label,
        actions: selected && (
          // 머리 카드의 글자 버튼(`Button` top — 24, DS `.at-btn.top`). 폴더가 사라진 프로젝트는 열 것이 없어 잠근다.
          <Button
            variant="ghost"
            size="top"
            disabled={selected.missing}
            onClick={() => projectsApi.openFolder(selected.slug)}
          >
            <FolderOpen aria-hidden />
            폴더 열기
          </Button>
        ),
        // 빨간 글자의 머리 버튼(DS `.at-btn.top.danger-text`) — 지나가도 빨간 글자 그대로다(hover는 면만 선다).
        end: selected && (
          <Button variant="ghost" size="top" className="text-danger hover:text-danger" onClick={handleRemove}>
            <Trash2 aria-hidden />
            제거
          </Button>
        ),
      }}
      list={{
        open: panelOpen,
        size: listSize,
        label: "프로젝트 목록",
        children: (
          <ProjectList
            projects={projects}
            selectedSlug={selected?.slug ?? null}
            onSelect={onSelect}
            onAdd={handleAdd}
          />
        ),
      }}
    >
      <Card
        as="main"
        label="프로젝트"
        className="flex-1"
        // 목록 토글은 목록 칸을 걷는 날(codex-ds 티켓 20)까지 상세 카드 머리 끝 그 자리다 — 프로젝트의 이름과 할 일은 머리 카드로 갔다.
        head={<CardHead end={<ListPanelToggle open={panelOpen} onToggle={togglePanel} />} />}
      >
        <div className="flex-1 overflow-y-auto scroll-quiet">
          {selected ? (
            <ProjectDetail project={selected} onOpenWork={onOpenWork} />
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Folder />
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
      </Card>
    </Frame>
  );
}

export default ProjectsPage;
