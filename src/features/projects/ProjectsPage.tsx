import { useState } from "react";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { Folder, FolderOpen, Trash2 } from "lucide-react";
import { Card, Frame } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
import useResizableWidth from "@/components/shell/useResizableWidth";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";
import { projectsApi } from "./api";
import { useCreateProject, useDeleteProject, useProjects, useUpdateProject } from "./hooks";

interface ProjectsPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  onOpenWork: (slug: string | null) => void;
}

function ProjectsPage({ sidebarOpen, selectedSlug, onSelect, onOpenWork }: ProjectsPageProps) {
  const { data: projects = [] } = useProjects();
  // 목록 칸의 폭 — 이 목록만 쓰는 키다(사이드바는 `sidebar-width`, 아카이브 목록은 `archive-panel-width`를 따로 갖는다). 기본은 DS
  // `size-list`(264)이고 범위는 240–560이다(codex-ds 스펙 S4). 사람이 바꿔 둔 폭은 범위 안이면 그대로 선다(`useResizableWidth`가
  // 저장값을 읽는 규칙). 목록 칸은 접지 않는다(codex-ds 결정 32) — 이 화면에는 오른쪽 패널이 없어 ⌘Enter를 듣는 자리도 없다.
  const listSize = useResizableWidth("panel-width", 264, 240, 560);
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  // **이름을 그 자리에서 고치는 중인 프로젝트**(codex-ds 스펙 §9) — 자리가 둘이라(머리 카드 이름 · 목록 행) 따로 든다. 값이 slug인
  // 것은 고친 대상이 고른 것과 다를 수 있어서다(목록 행은 고르지 않은 행에서도 F2로 고친다). 머리 카드 쪽은 고른 프로젝트가 바뀌면
  // 그 그림에서 곧바로 꺼진다(`editing`이 `selected.slug`와 견준다) — 입력칸이 blur 없이 내려가도 마지막 그림의 값으로 저장하고 끝을
  // 알려 이 값을 비운다(`InlineRename`). 저장은 지금 프로젝트 고치기 명령의 이름만 실은 patch다.
  const [renamingHead, setRenamingHead] = useState<string | null>(null);
  const [renamingRow, setRenamingRow] = useState<string | null>(null);
  const rename = (slug: string, name: string) => updateProject.mutate({ slug, patch: { name } });

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
    // 공용 틀 위의 목록 | 상세 카드 하나(codex-ds 결정 28 — 0.5px 세로 선이 두 칸을 가른다). 머리 줄에는 고른 프로젝트의 머리 카드가
    // 선다(codex-ds 스펙 §7).
    <Frame
      sidebarOpen={sidebarOpen}
      // 머리 카드 — 왼쪽은 폴더 아이콘과 고른 프로젝트의 이름(고른 것이 없으면 nav의 화면 이름)이다. 오른쪽은 그 프로젝트에 거는 할 일인
      // 폴더 열기 | 제거다(스토리 52). 제거는 되돌릴 수 없는 할 일이라 세로선 너머에 떼어 둔다(DS 캔버스). 캔버스의 「LLM이 받는
      // 텍스트」는 지금 앱에 없는 조작이라 짓지 않는다(codex-ds 스펙 S13). **고른 프로젝트의 이름은 그 자리에서 바꾼다**(codex-ds 스펙
      // §9 · S12 — 이름의 두 번 클릭 · F2, `rename`). 상세 칸에는 제목이 없다 — 이름은 머리 카드가 든다. 이 이름의 메뉴(우클릭)는
      // codex-ds 티켓 30이다.
      head={{
        icon: Folder,
        name: selected?.name ?? navItem("projects").label,
        rename: selected
          ? {
              editing: renamingHead === selected.slug,
              onStart: () => setRenamingHead(selected.slug),
              onEnd: () => setRenamingHead(null),
              onCommit: (name) => rename(selected.slug, name),
              label: "프로젝트 이름",
            }
          : undefined,
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
        size: listSize,
        label: "프로젝트 목록",
        children: (
          <ProjectList
            projects={projects}
            selectedSlug={selected?.slug ?? null}
            onSelect={onSelect}
            onAdd={handleAdd}
            renaming={renamingRow}
            onRename={setRenamingRow}
            onRenameCommit={rename}
            onRenameEnd={() => setRenamingRow(null)}
          />
        ),
      }}
    >
      {/* 상세 칸 — 목록 | 상세 카드의 오른쪽 칸이다. 머리가 없다: 프로젝트의 이름과 할 일은 머리 카드가 들고, 칸 안에 고를 것이 없다. */}
      <Card as="main" label="프로젝트" className="flex-1">
        {/* 옆은 글 거터 20이다 — 설정 본문과 같은 나눔이다(위 24 · 글 폭은 상세의 몸이 든다, `ProjectDetail`). */}
        <div className="flex-1 overflow-y-auto px-5 scroll-quiet">
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
