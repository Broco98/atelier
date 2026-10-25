import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Book, ChevronRight, Copy, Download, Folder, GitBranch, MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";
import { ListPanel, ListRow, ListTable, SearchPill } from "@/components/catalog/ListParts";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { projectDirRef } from "@/features/works/refs";
import { addProject } from "./add-store";
import { projectsApi } from "./api";
import { useFolderDrop } from "./folder-drop";
import { useProjects } from "./hooks";
import { firstFolder } from "./project-add";
import { rowMenu, shownProjects, type RowAct } from "./project-view";
import { useProjectRemoval } from "./ProjectRemoveDialog";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// Projects 목록(03 구현 스펙 §16 · 시안 F1-Projects · F4-ProjMissing · F4-KitProject 「목록 줄」) — 사람 메뉴 「Projects」가 여는 화면이다. 머리 줄
// 「Projects」, 판 안에 제목 · 찾기 칸 · 「Project 추가」와 표(이름 · 경로 · 기준 브랜치), 표 아래 끌어 놓기 한 줄. 줄을 누르면 상세
// (`/projects/$slug`)이고, 고치는 일(이름 · 설명 · 기준 브랜치)은 상세가 든다. 제거는 줄 ⋯ 안에만 있다 — 세 갈래 창(`useProjectRemoval`)을 거치고,
// 지운 뒤 「되돌리기」 토스트가 잠깐 선다. 판 · 찾기 칸 · 표 · 줄의 꼴은 Space 목록과 같은 것이다(`@/components/catalog` — 03 코드 리뷰 D1).
//
// 추가는 추가 창 하나다(09 — `addProject`). 폴더를 이 화면에 끌어다 놓으면 창이 그 폴더로 열린다(여럿이면 첫 폴더 — S20).

/** 표의 칸 — 이름 · 경로 · 기준 브랜치 · ⋯. 머리 줄과 몸 줄이 같은 격자다(시안 `.th` · `.prow-h`). */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_156px_28px] items-center gap-4 pr-2.5 pl-3.5";

export default function ProjectsPage() {
  const { data: projects = [], isPending } = useProjects();
  const navigate = useNavigate();
  const removing = useProjectRemoval();
  const relocate = useRelocate();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => shownProjects(projects, query), [projects, query]);
  const label = navItem("projects").label;
  const open = (slug: string) => void navigate({ to: "/projects/$slug", params: { slug } });

  // 추가한 Project의 상세로 간다 — 추가 창이 이름 · 폴더를 정했고, 설명 · 기준 브랜치는 상세가 고친다.
  const handleAdd = async (folder: string | null = null) => {
    const added = await addProject(folder);
    if (added) open(added.slug);
  };
  useFolderDrop((paths) => {
    void firstFolder(paths, projectsApi.inspect).then((folder) => {
      if (folder) void handleAdd(folder);
    });
  });

  const act = (project: ProjectView, what: RowAct) => {
    if (what === "open-folder") openInFinder(() => projectsApi.openFolder(project.slug));
    else if (what === "copy-path") copyText(projectDirRef(project.path));
    else void removing.ask(project);
  };

  const empty = !isPending && projects.length === 0;
  return (
    <PlainFrame label={label} title={{ name: label }}>
      <ListPanel
        title={label}
        tools={
          // 찾기 · 추가는 목록이 있을 때만 — 빈 목록은 가운데 안내가 「Project 추가」를 든다(시안 `notEmpty`).
          !empty && (
            <>
              <SearchPill label="Project 찾기" value={query} onChange={setQuery} />
              <Button size="top" className="rounded-full" onClick={() => void handleAdd()}>
                <Plus aria-hidden />
                Project 추가
              </Button>
            </>
          )
        }
        after={removing.dialog}
      >
        {empty ? (
          <EmptyProjects onAdd={() => void handleAdd()} />
        ) : (
          <>
            <ListTable
              label="Project 목록"
              columns={COLUMNS}
              heads={["이름", "경로", "기준 브랜치"]}
              after={
                projects.length > 0 &&
                shown.length === 0 && <p className="px-3.5 py-4.5 text-chat-meta text-fg-tertiary">찾는 Project가 없어요</p>
              }
            >
              {shown.map((project) => (
                <ProjectRow
                  key={project.slug}
                  project={project}
                  onOpen={() => open(project.slug)}
                  onAct={(what) => act(project, what)}
                  onRelocate={() => void relocate(project)}
                />
              ))}
            </ListTable>
            {/* 목록 아래 한 줄(스토리 100) — 폴더를 이 화면에 끌어다 놓으면 추가 창이 그 폴더로 열린다(`useFolderDrop`). */}
            <p className="flex items-center gap-1.5 px-3.5 text-xs text-fg-tertiary">
              <Download className="size-3.5 shrink-0" aria-hidden />
              폴더를 이 창에 끌어다 놓아도 추가돼요
            </p>
          </>
        )}
      </ListPanel>
    </PlainFrame>
  );
}

/** 빈 목록(스토리 97) — 처음 할 일을 가운데에 세운다. 찾기 · 「Project 추가」 머리 단추는 서지 않는다. */
function EmptyProjects({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 pb-30 text-center">
      <span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-surface-empty-mark text-fg-icon">
        <Book className="size-4.5" />
      </span>
      <h2 className="text-heading-xs text-fg">아직 Project가 없어요</h2>
      <p className="max-w-95 text-chat-meta text-fg-secondary">
        이 컴퓨터의 git 레포 폴더를 추가하거나, 빈 레포를 새로 만들어요. 코드는 옮기지 않아요.
      </p>
      <Button size="top" className="mt-1 rounded-full" onClick={onAdd}>
        <Plus aria-hidden />
        Project 추가
      </Button>
      <span className="text-xs text-fg-tertiary">폴더를 이 창에 끌어다 놓아도 돼요</span>
    </div>
  );
}

/**
 * 표의 줄 하나(스토리 95 · 101 · 시안 `.prow`) — 줄의 꼴 · 누름은 `ListRow`다. 지나면 이름 끝 꺾쇠가 선다. 줄 어디를 눌러도 상세다 — 이름이 그
 * 링크이고(키보드는 이름에 선다), ⋯ · 「재설정」은 제 일만 한다.
 *
 * 폴더를 찾을 수 없는 Project는 이름이 흐리고, 경로 칸이 「⚠ Project를 찾을 수 없어요 · 경로」, 기준 브랜치 칸이 「재설정」이다. ⋯는 「제거…」만.
 */
function ProjectRow({
  project,
  onOpen,
  onAct,
  onRelocate,
}: {
  project: ProjectView;
  onOpen: () => void;
  onAct: (what: RowAct) => void;
  onRelocate: () => void;
}) {
  const missing = project.missing;
  return (
    <ListRow columns={COLUMNS} onOpen={onOpen}>
      <span role="cell" className="flex min-w-0 items-center">
        {/* `tabIndex`를 명시한다 — WebKit의 Tab은 맨 링크에 서지 않는다(`@/lib/roving` 머리말의 맨 `<button>`과 같다). 줄의 Tab 자리가
            이 링크다(03 결정 「10」). */}
        <Link
          to="/projects/$slug"
          params={{ slug: project.slug }}
          tabIndex={0}
          className="-mx-1 flex min-w-0 items-center gap-2.5 rounded-md px-1 focus-ring"
        >
          <Book aria-hidden className={cn("size-4 shrink-0", missing ? "text-fg-faint" : "text-fg-icon")} />
          <span className={cn("min-w-0 truncate", missing && "text-fg-tertiary")}>{project.name}</span>
          <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-row-act opacity-0 group-hover/row:opacity-100" />
        </Link>
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-fg-tertiary">
        {missing && (
          <span className="flex shrink-0 items-center gap-1 text-fg-notice-warn-line">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            Project를 찾을 수 없어요
          </span>
        )}
        <span className="min-w-0 truncate font-mono">{project.path}</span>
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
        {missing ? (
          <Button variant="outline" size="xs" className="rounded-full text-fg" onClick={onRelocate}>
            재설정
          </Button>
        ) : (
          <>
            <GitBranch aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-mono">{project.baseBranch}</span>
          </>
        )}
      </span>
      <span role="cell" className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${project.name} 메뉴`}
            className="icon-button text-fg-row-act transition-colors quiet-hover focus-ring"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="act">
            {rowMenu(project).map((item) => {
              const Icon = ROW_ICONS[item.act];
              return (
                <Fragment key={item.act}>
                  {item.apart && <DropdownMenuSeparator />}
                  <DropdownMenuItem variant={item.danger ? "destructive" : "default"} onClick={() => onAct(item.act)}>
                    <Icon />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </ListRow>
  );
}

/** ⋯ 항목의 글리프(시안 `row_menu` — 폴더 · 문서 · ×). */
const ROW_ICONS: Record<RowAct, typeof Folder> = { "open-folder": Folder, "copy-path": Copy, remove: X };
