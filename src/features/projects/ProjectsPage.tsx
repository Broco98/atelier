import { Fragment, useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Book, ChevronRight, Copy, Download, Folder, GitBranch, MoreHorizontal, Plus, Search, TriangleAlert, X } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { Button } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showUndoToast, Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { projectDirRef } from "@/features/works/refs";
import { addProject } from "./add-store";
import { projectsApi } from "./api";
import { useFolderDrop } from "./folder-drop";
import { useProjects, useRemoveProject, useRestoreProject } from "./hooks";
import { firstFolder } from "./project-add";
import { removedToast, restoreProblem } from "./project-remove";
import { rowMenu, shownProjects, type RowAct } from "./project-view";
import ProjectRemoveDialog, { type Removing } from "./ProjectRemoveDialog";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// Projects 목록(03 구현 스펙 §16 · 시안 F1-Projects · F4-ProjMissing · F4-KitProject 「목록 줄」) — 사람 메뉴 「Projects」가 여는 화면이다. 머리 줄
// 「Projects」, 판 안에 제목 · 찾기 칸 · 「Project 추가」와 표(이름 · 경로 · 기준 브랜치), 표 아래 끌어 놓기 한 줄. 줄을 누르면 상세
// (`/projects/$slug`)이고, 고치는 일(이름 · 설명 · 기준 브랜치)은 상세가 든다. 제거는 줄 ⋯ 안에만 있다 — 세 갈래 창(`ProjectRemoveDialog`)을 거치고,
// 지운 뒤 「되돌리기」 토스트가 잠깐 선다.
//
// 추가는 추가 창 하나다(09 — `addProject`). 폴더를 이 화면에 끌어다 놓으면 창이 그 폴더로 열린다(여럿이면 첫 폴더 — S20).

/** 표의 칸 — 이름 · 경로 · 기준 브랜치 · ⋯. 머리 줄과 몸 줄이 같은 격자다(시안 `.th` · `.prow-h`). */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_156px_28px] items-center gap-4 pr-2.5 pl-3.5";

export default function ProjectsPage() {
  const { data: projects = [], isPending } = useProjects();
  const navigate = useNavigate();
  const removeProject = useRemoveProject();
  const restoreProject = useRestoreProject();
  const [removing, setRemoving] = useState<Removing | null>(null);
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

  // 제거는 창을 거친다(03 구현 스펙 §16) — 창의 갈래는 core가 읽은 쓰임(이 Project를 적은 Space · 고치는 진행 중인 Work)이 정한다. 폴더 ·
  // 파일 · git 기록은 그대로다.
  const handleRemove = async (project: ProjectView) => {
    try {
      setRemoving({ project, usage: await projectsApi.usage(project.slug) });
    } catch (e) {
      await showProblem(`제거하지 못했어요 — ${e}`);
    }
  };
  // 창의 「제거」 — 그사이 진행 중인 Work가 이 Project를 붙였으면 core가 막고 창이 막힌 갈래로 바뀐다. 뺐으면 창을 닫고 되돌리기 토스트를 낸다.
  const confirmRemove = async (project: ProjectView) => {
    try {
      const removal = await removeProject.mutateAsync(project.slug);
      if (removal.kind === "blocked") {
        setRemoving({ project, usage: { spaces: [], works: removal.works } });
        return;
      }
      setRemoving(null);
      showUndoToast(removedToast(project.name), () => {
        restoreProject.mutateAsync(project.slug).catch((e) => void showProblem(restoreProblem(String(e))));
      });
    } catch (e) {
      setRemoving(null);
      await showProblem(`제거하지 못했어요 — ${e}`);
    }
  };
  const act = (project: ProjectView, what: RowAct) => {
    if (what === "open-folder") openInFinder(() => projectsApi.openFolder(project.slug));
    else if (what === "copy-path") copyText(projectDirRef(project.path));
    else void handleRemove(project);
  };

  const empty = !isPending && projects.length === 0;
  return (
    <PlainFrame label={label} title={{ name: label }}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-10 pt-7.5 pb-10 scroll-quiet">
          {/* 본문 맨 위 줄(제목 · 찾기 · 추가) — `<header>`가 아니다: 창의 머리는 머리 줄 하나다(ui-refresh 결정 5 · `ShellHead`). */}
          <div className="flex min-h-8 items-center gap-2.5">
            <h1 className="text-heading-md text-fg">{label}</h1>
            {/* 찾기 · 추가는 목록이 있을 때만 — 빈 목록은 가운데 안내가 「Project 추가」를 든다(시안 `notEmpty`). */}
            {!empty && (
              <>
                <label className="ml-auto flex h-7.5 w-60 items-center gap-1.5 rounded-full border border-border-heavy px-3 text-fg-tertiary focus-ring">
                  <Search aria-hidden className="size-3.5 shrink-0" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Project 찾기"
                    aria-label="Project 찾기"
                    className="min-w-0 flex-1 bg-transparent text-chat-meta text-fg outline-none placeholder:text-fg-tertiary"
                  />
                </label>
                <Button size="top" className="rounded-full" onClick={() => void handleAdd()}>
                  <Plus aria-hidden />
                  Project 추가
                </Button>
              </>
            )}
          </div>
          {empty ? (
            <EmptyProjects onAdd={() => void handleAdd()} />
          ) : (
            <>
              <div role="table" aria-label="Project 목록" className="flex flex-col">
                <div role="row" className={cn(COLUMNS, "h-7.5 text-xs text-fg-tertiary")}>
                  <span role="columnheader">이름</span>
                  <span role="columnheader">경로</span>
                  <span role="columnheader">기준 브랜치</span>
                  <span role="columnheader" aria-hidden />
                </div>
                {shown.map((project) => (
                  <ProjectRow
                    key={project.slug}
                    project={project}
                    onOpen={() => open(project.slug)}
                    onAct={(what) => act(project, what)}
                    onRelocate={() => void relocate(project)}
                  />
                ))}
                {/* 마지막 줄 아래 선 — 줄마다 위 선이라 끝에 한 줄 더 둔다(시안 `.pend`). */}
                <div aria-hidden className="mx-2.5 h-[0.5px] bg-separator" />
                {projects.length > 0 && shown.length === 0 && (
                  <p className="px-3.5 py-4.5 text-chat-meta text-fg-tertiary">찾는 Project가 없어요</p>
                )}
              </div>
              {/* 목록 아래 한 줄(스토리 100) — 폴더를 이 화면에 끌어다 놓으면 추가 창이 그 폴더로 열린다(`useFolderDrop`). */}
              <p className="flex items-center gap-1.5 px-3.5 text-xs text-fg-tertiary">
                <Download className="size-3.5 shrink-0" aria-hidden />
                폴더를 이 창에 끌어다 놓아도 추가돼요
              </p>
            </>
          )}
        </div>
        {/* 「경로 복사」 · Finder를 못 연 문장과 지운 뒤의 「되돌리기」가 여기 선다 — 본문 아래 가운데(시안 `.toast`). */}
        <Toaster />
        <ProjectRemoveDialog
          removing={removing}
          busy={removeProject.isPending}
          onClose={() => setRemoving(null)}
          onRemove={(project) => void confirmRemove(project)}
        />
      </div>
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
 * 표의 줄 하나(스토리 95 · 101 · 시안 `.prow`) — 48 · 둥글기 12, 줄 위에 0.5 선(옆 10 들여), 지나면 옅은 면과 이름 끝 꺾쇠가 서고 그 줄의 위아래
 * 선이 숨는다. 줄 어디를 눌러도 상세다 — 이름이 그 링크이고(키보드는 이름에 선다), 줄의 누름은 ⋯ · 「재설정」이 아닐 때만 상세로 간다.
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
  // 줄의 누름 — 줄 안 단추 · 링크와 메뉴(포털로 떠도 React 나무로는 줄 안이라 누름이 올라온다)에서 온 것은 제 일만 한다.
  const openFromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest("a, button")) return;
    onOpen();
  };
  return (
    <div
      role="row"
      onClick={openFromRow}
      className={cn(
        COLUMNS,
        "group/row relative h-12 rounded-xl text-sm text-fg transition-colors hover:bg-fill-soft",
        "before:absolute before:inset-x-2.5 before:top-0 before:h-[0.5px] before:bg-separator hover:before:opacity-0",
        "[&:hover+[role=row]]:before:opacity-0 [&:hover+[aria-hidden]]:opacity-0",
      )}
    >
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
    </div>
  );
}

/** ⋯ 항목의 글리프(시안 `row_menu` — 폴더 · 문서 · ×). */
const ROW_ICONS: Record<RowAct, typeof Folder> = { "open-folder": Folder, "copy-path": Copy, remove: X };
