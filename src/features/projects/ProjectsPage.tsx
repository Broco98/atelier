import { cloneElement, useState, type HTMLAttributes, type ReactElement } from "react";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { Folder, FolderOpen, Trash2 } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import { Card, Frame } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { TargetMenu } from "@/components/shell/TargetMenu";
import useResizableWidth from "@/components/shell/useResizableWidth";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Toaster } from "@/components/ui/toast";
import { projectDirRef } from "@/features/works/refs";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";
import { ProjectMenuItems } from "./ProjectMenuItems";
import { useAddProject } from "./add-project";
import { projectsApi } from "./api";
import { useDeleteProject, useProjects, useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectsPageProps {
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
  onOpenWork: (slug: string) => void;
}

function ProjectsPage({ selectedSlug, onSelect, onOpenWork }: ProjectsPageProps) {
  const { data: projects = [] } = useProjects();
  // 목록 칸의 폭 — 이 목록만 쓰는 키다(사이드바는 `sidebar-width`, 아카이브 목록은 `archive-panel-width`를 따로 갖는다). 기본은 DS
  // `size-list`(264)이고 범위는 240–560이다(codex-ds 스펙 S4). 사람이 바꿔 둔 폭은 범위 안이면 그대로 선다(`useResizableWidth`가
  // 저장값을 읽는 규칙). 목록 칸은 카드의 오른쪽 칸이라(`Frame`의 `ListCard`) 손잡이가 칸의 왼쪽 끝이다 — `"right"`가 끄는 방향을
  // 뒤집는다. 목록 칸은 접지 않는다(codex-ds 결정 32) — 이 화면에는 오른쪽 패널이 없어 ⌘Enter를 듣는 자리도 없다.
  const listSize = useResizableWidth("panel-width", 264, 240, 560, "right");
  const addProject = useAddProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  // **이름을 그 자리에서 고치는 중인 프로젝트**(codex-ds 스펙 §9) — 자리가 둘이라(머리 줄 이름 · 목록 행) 따로 든다. 값이 slug인
  // 것은 고친 대상이 고른 것과 다를 수 있어서다(목록 행은 고르지 않은 행에서도 F2로 고친다). 머리 줄 쪽은 고른 프로젝트가 바뀌면
  // 그 그림에서 곧바로 꺼진다(`editing`이 `selected.slug`와 견준다) — 입력칸이 blur 없이 내려가도 마지막 그림의 값으로 저장하고 끝을
  // 알려 이 값을 비운다(`InlineRename`). 저장은 지금 프로젝트 고치기 명령의 이름만 실은 patch다.
  const [renamingHead, setRenamingHead] = useState<string | null>(null);
  const [renamingRow, setRenamingRow] = useState<string | null>(null);
  const rename = (slug: string, name: string) => updateProject.mutate({ slug, patch: { name } });

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/projects.index.tsx)
  const selected = projects.find((p) => p.slug === selectedSlug) ?? null;

  // 추가의 길은 하나다(`useAddProject` — Space 상세의 「새 Project 추가…」와 같다). 등록하면 그 Project를 고른다.
  const handleAdd = async () => {
    const view = await addProject();
    if (view) onSelect(view.slug);
  };

  // **제거는 그 프로젝트의 것이다** — 머리 줄의 [제거]는 고른 프로젝트이고, 목록 행의 메뉴는 고르지 않은 행일 수 있다(codex-ds
  // 결정 7). 확인 창을 거친 뒤에만 나가고, 고른 프로젝트를 뺐을 때만 고름을 비운다 — 다른 행을 빼도 보던 프로젝트는 그대로다.
  const handleRemove = async (project: ProjectView) => {
    const ok = await askDanger(
      `'${project.name}' 제거`,
      "코드 폴더는 삭제되지 않고 Atelier 목록에서만 제거됩니다.",
      "제거",
    );
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(project.slug);
      if (project.slug === selectedSlug) onSelect(null);
    } catch (e) {
      await showProblem(`제거하지 못했습니다: ${e}`);
    }
  };

  // **프로젝트 메뉴**(codex-ds 스펙 §9 대상 메뉴 표 · 티켓 30) — 목록 행과 머리 줄 이름의 우클릭 · ⇧F10이 편다. 목록은 한 정의
  // (`ProjectMenuItems`)이고 부르는 길도 한 벌이다 — 자리마다 다른 것은 「이름 바꾸기」가 입력칸을 세우는 자리뿐이다(`startRename`).
  // 메뉴는 slug를 겨누고 펼 때마다 목록에서 찾는다 — 열어 둔 사이 그 프로젝트가 빠지면 항목도 사라진다.
  // - Finder 열기는 머리 줄의 「폴더 열기」와 같은 명령이고, 못 열면 코어의 문장을 토스트로 알린다(`openInFinder`).
  // - 경로 복사는 그 폴더의 참조(`projectDirRef` — 끝에 `/`)이고, Works · Archive의 복사와 한 길로 「… 복사됨」 토스트가 말한다
  //   (`copyText` · 아래 `Toaster`).
  const projectMenu = (slug: string, leaveFocus: () => void, startRename: (slug: string) => void) => {
    const project = projects.find((one) => one.slug === slug);
    if (!project) return null;
    return (
      <ProjectMenuItems
        project={project}
        actions={{
          openFolder: () => openInFinder(() => projectsApi.openFolder(project.slug)),
          copyPath: () => copyText(projectDirRef(project.path)),
          rename: () => {
            leaveFocus();
            startRename(project.slug);
          },
          remove: () => void handleRemove(project),
        }}
      />
    );
  };

  return (
    // 공용 틀 위의 상세 | 목록 카드 하나(codex-ds 결정 28 — 0.5px 세로 선이 두 칸을 가른다). 머리 줄에는 고른 프로젝트의 이름 · 할
    // 일이 선다(codex-ds 스펙 §7).
    <Frame
      // 머리 줄 — 왼쪽은 폴더 아이콘과 고른 프로젝트의 이름(고른 것이 없으면 nav의 화면 이름)이다. 오른쪽은 그 프로젝트에 거는 할 일인
      // 폴더 열기 | 제거다(스토리 52). 제거는 되돌릴 수 없는 할 일이라 세로선 너머에 떼어 둔다(DS 캔버스). 캔버스의 「LLM이 받는
      // 텍스트」는 지금 앱에 없는 조작이라 짓지 않는다(codex-ds 스펙 S13). **고른 프로젝트의 이름은 그 자리에서 바꾼다**(codex-ds 스펙
      // §9 · S12 — 이름의 두 번 클릭 · F2, `rename`). 상세 칸에는 제목이 없다 — 이름은 머리 줄이 든다.
      //
      // **이름은 프로젝트 메뉴의 대상이다**(`nameMenu` — 위 `projectMenu`). 우클릭하거나 포커스해 ⇧F10 · 메뉴 키를 누르면 이름 곁에
      // 선다(키는 틀의 이름이 우클릭 사건으로 바꿔 낸다 — `openMenuByKey`). `key`가 프로젝트를 갈아 끼우면 메뉴를 새로 세운다 — 열어 둔
      // 채 다른 프로젝트로 옮기면 메뉴가 화면에 보이는 것과 다른 프로젝트를 겨눈다(작업 화면의 이름 메뉴와 같은 까닭). 열린 동안의 대상
      // 테두리는 `TargetMenu`가 이름 요소에 직접 달고 걷는다(`ring`) — 틀이 그리는 표식(`renderName(true)`)은 쓰지 않는다.
      head={{
        icon: Folder,
        name: selected?.name ?? navItem("projects").label,
        nameMenu: selected
          ? (renderName) => (
              <TargetMenu
                key={selected.slug}
                targetOf={(_from, region) => ({ of: selected.slug, ring: region })}
                items={(slug, menu) => projectMenu(slug, menu.leaveFocus, setRenamingHead)}
              >
                {(region) =>
                  cloneElement(renderName(false) as ReactElement<HTMLAttributes<HTMLElement>>, {
                    onContextMenu: region.onContextMenu,
                  })
                }
              </TargetMenu>
            )
          : undefined,
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
          // 머리 줄의 글자 버튼(`Button` top — 28, 머리 줄의 단추는 모두 28이다). 폴더가 사라진 프로젝트는 열 것이 없어 잠근다.
          <Button
            variant="ghost"
            size="top"
            disabled={selected.missing}
            onClick={() => openInFinder(() => projectsApi.openFolder(selected.slug))}
          >
            <FolderOpen aria-hidden />
            폴더 열기
          </Button>
        ),
        // 빨간 글자의 머리 버튼(DS `.at-btn.top.danger-text`) — 지나가도 빨간 글자 그대로다(hover는 면만 선다).
        end: selected && (
          <Button
            variant="ghost"
            size="top"
            className="text-danger hover:text-danger"
            onClick={() => void handleRemove(selected)}
          >
            <Trash2 aria-hidden />
            제거
          </Button>
        ),
      }}
      list={{
        size: listSize,
        label: "프로젝트 목록",
        // 목록 행의 메뉴 — 행 목록 하나가 메뉴 하나를 맡는다(`TargetMenu`). 대상은 우클릭 · 키가 난 행이고, 고른 행이 아니어도 그 행의
        // 프로젝트다(결정 7). 행 버튼이 테두리를 입고 포커스가 돌아갈 자리다.
        children: (
          <TargetMenu
            targetOf={(from) => {
              const row = from.closest<HTMLElement>("button[data-project-row]");
              const slug = row?.dataset.projectRow;
              return row && slug ? { of: slug, ring: row } : null;
            }}
            items={(slug, menu) => projectMenu(slug, menu.leaveFocus, setRenamingRow)}
          >
            {(region) => (
              <ProjectList
                projects={projects}
                selectedSlug={selected?.slug ?? null}
                onSelect={onSelect}
                onAdd={handleAdd}
                renaming={renamingRow}
                onRename={setRenamingRow}
                onRenameCommit={rename}
                onRenameEnd={() => setRenamingRow(null)}
                rowMenu={region}
              />
            )}
          </TargetMenu>
        ),
      }}
      // 토스트의 자리 — 카드 줄의 아래 가운데다(작업 화면 · Archive와 같은 부품 · 같은 상자). 프로젝트 메뉴의 「경로 복사」와 Finder를 못
      // 연 문장이 여기 선다.
      overlay={<Toaster />}
    >
      {/* 상세 칸 — 상세 | 목록 카드의 왼쪽 칸이다. 머리가 없다: 프로젝트의 이름과 할 일은 머리 줄이 들고, 칸 안에 고를 것이 없다. */}
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
