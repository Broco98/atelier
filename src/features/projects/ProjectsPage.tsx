import { useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { Copy, Folder, FolderOpen, GitBranch, MoreHorizontal, SquarePen, Trash2 } from "lucide-react";
import { HeadCrumb } from "@/components/catalog/DetailParts";
import { FIRST_SORT, nextSort, placeWhen, sortPlaces, type PlaceSort } from "@/components/catalog/place-list";
import {
  PLACE_ROW_BUTTON,
  PlaceAdd,
  PlaceEmpty,
  PlaceFix,
  PlaceList,
  PlaceRow,
  PlaceSearch,
  PlaceSkeleton,
  PlaceStage,
  PlaceTable,
  useLate,
} from "@/components/catalog/PlaceList";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { useThreads } from "@/features/thread/hooks";
import { startSearch } from "@/routes/-new-thread-search";
import { projectDirRef } from "@/features/works/refs";
import { useWorks } from "@/features/works/hooks";
import { addProject } from "./add-store";
import { projectsApi } from "./api";
import { useFolderDrop } from "./folder-drop";
import { useProjects } from "./hooks";
import { projectActivity } from "./project-activity";
import { firstFolder } from "./project-add";
import { rowMenu, shownProjects, type RowAct } from "./project-view";
import { useProjectRemoval } from "./ProjectRemoveDialog";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// **Projects**(restart 03-1 · 스펙 「03 — 목록과 상세」 · 스토리 8 · 13 · 107 – 113 · 119 · 121 · 보드 MainProjects · PlaceSheet · Places) — 사이드바 위 칸
// 「Projects」가 여는 자리다. 공용 목록 틀(`PlaceList`)에 선 첫 화면이다. 목록과 상세(`/projects/$slug`)가 한 자리를 번갈아 쓴다(`PlaceStage`) —
// 이 라우트(`/projects`)가 둘의 틀이라 상세에 가 있는 동안에도 목록은 마운트된 채 숨어, 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로다. 창 머리의
// 뒤로 · 앞으로는 주소의 히스토리라 목록과 상세도 오간다.
//
//   머리 줄 ─ 목록은 「Projects」, 상세는 「Projects / 이름」(눌러 목록으로)
//   목록 ─ 제목 · 「Project 찾기」 · 「Project 추가」, 이름(경로) · 최근 활동 · 오른쪽 동작(⋯ · 작업공간 만들기 · 새 채팅)
//
// - **최근 활동**은 작업공간과 채팅의 활동에서 짓고 저장하지 않는다(`projectActivity`). 처음 차례는 최근 활동 순이다.
// - **줄의 「작업공간 만들기」 · 「새 채팅」**은 그 Project를 범위로 고른 새 채팅을 연다(01a-13 · 01a-14의 씨앗 — `?new=work&project=` ·
//   `?new=thread&project=`). 폴더를 찾을 수 없는 줄에는 서지 않고 「재설정」이 선다(⋯ 안이 아니라 줄 끝 — 스토리 119).
// - **그대로 쓰는 것**(스토리 121) — 빈 목록의 할 일, 폴더를 이 화면에 끌어다 놓으면 추가 창이 그 폴더로 열리는 것(`useFolderDrop`), 제거의 세
//   갈래 창과 「되돌리기」 토스트(`useProjectRemoval`), 재설정(`useRelocate`).

/** `/projects`의 틀 — 머리 줄과 목록 · 상세의 자리. 상세는 자식 라우트(`/projects/$slug`)가 그린다. */
export default function ProjectsPlace() {
  const { slug } = useParams({ strict: false });
  const { data: projects = [] } = useProjects();
  const navigate = useNavigate();
  const label = navItem("projects").label;
  const detail = slug === undefined ? null : (projects.find((one) => one.slug === slug) ?? null);
  return (
    <PlainFrame
      label={slug === undefined ? label : `${label} 상세`}
      lead={slug !== undefined && <HeadCrumb label={label} onOpen={() => void navigate({ to: "/projects" })} />}
      title={slug === undefined ? { name: label } : detail ? { name: detail.name } : undefined}
    >
      <PlaceStage list={<ProjectList />} detail={<Outlet />} detailKey={slug ?? null} />
    </PlainFrame>
  );
}

/** Projects 목록 — 찾기 · 정렬 · 줄. 상세에 가 있는 동안에도 마운트된 채라 이 상태가 남는다. */
function ProjectList() {
  const { data: projects = [], isPending } = useProjects();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const navigate = useNavigate();
  const removing = useProjectRemoval();
  const relocate = useRelocate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PlaceSort>(FIRST_SORT);
  const late = useLate(isPending);
  const label = navItem("projects").label;

  const activity = useMemo(() => projectActivity(projects.map((one) => one.slug), works, threads), [projects, works, threads]);
  const rows = useMemo(
    () =>
      sortPlaces(
        shownProjects(projects, query),
        sort,
        (one) => one.name,
        (one) => activity[one.slug] ?? null,
      ),
    [projects, query, sort, activity],
  );
  // 시각 글은 그린 때의 지금으로 센다 — 목록에 돌아오거나 줄이 바뀌면 새로 센다.
  const now = Date.now();

  const open = (slug: string) => void navigate({ to: "/projects/$slug", params: { slug } });
  const start = (slug: string, what: "work" | "thread") => void navigate({ to: "/", search: startSearch(what, { project: slug }) });
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
  const needle = query.trim();
  return (
    <PlaceList
      title={label}
      tools={
        // 찾기 · 추가는 목록이 있을 때만 — 빈 목록은 가운데 할 일이 「Project 추가」를 들고, 처음 읽는 동안은 제목뿐이다(보드 `showTools`).
        !empty &&
        !isPending && (
          <>
            <PlaceSearch label="Project 찾기" value={query} onChange={setQuery} />
            <PlaceAdd label="Project 추가" onClick={() => void handleAdd()} />
          </>
        )
      }
      after={removing.dialog}
    >
      {isPending ? (
        late && <PlaceSkeleton whenLabel="최근 활동" />
      ) : empty ? (
        <PlaceEmpty
          icon={<Folder />}
          title="등록한 Project가 없어요"
          body="폴더를 이 화면에 끌어다 놓거나 Project를 추가하면, 그 폴더를 범위로 채팅하고 작업공간을 만들 수 있어요."
          action={<PlaceAdd label="Project 추가" onClick={() => void handleAdd()} className="mt-1.5" />}
        />
      ) : (
        <PlaceTable
          label="Project 목록"
          whenLabel="최근 활동"
          sort={sort}
          onSort={(key) => setSort((held) => nextSort(held, key))}
          empty={rows.length === 0 ? `「${needle}」와 맞는 Project가 없어요` : null}
        >
          {rows.map((project) => (
            <ProjectRow
              key={project.slug}
              project={project}
              when={placeWhen(activity[project.slug] ?? null, now)}
              onOpen={() => open(project.slug)}
              onStart={(what) => start(project.slug, what)}
              onAct={(what) => act(project, what)}
              onRelocate={() => void relocate(project)}
            />
          ))}
        </PlaceTable>
      )}
    </PlaceList>
  );
}

/**
 * 줄 하나(보드 Places 줄 · 스토리 95 · 101 · 119) — 폴더 글리프 · 이름 · 경로, 최근 활동, 오른쪽에 ⋯ · 작업공간 만들기 · 새 채팅. 폴더를 찾을 수 없는
 * Project는 이름이 흐리고 경로 자리가 「폴더를 찾을 수 없어요 · 경로」이며, 오른쪽이 「재설정」 · ⋯다(⋯는 「제거…」만).
 */
function ProjectRow({
  project,
  when,
  onOpen,
  onStart,
  onAct,
  onRelocate,
}: {
  project: ProjectView;
  when: string;
  onOpen: () => void;
  onStart: (what: "work" | "thread") => void;
  onAct: (what: RowAct) => void;
  onRelocate: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const missing = project.missing;
  return (
    <PlaceRow
      anchor={wrap}
      icon={<Folder />}
      name={project.name}
      link={{ to: "/projects/$slug", params: { slug: project.slug } }}
      desc={missing ? `폴더를 찾을 수 없어요 · ${project.path}` : project.path}
      when={when}
      missing={missing}
      onOpen={onOpen}
      actions={
        <>
          {missing && <PlaceFix label="재설정" onClick={onRelocate} />}
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`${project.name} 메뉴`} className={PLACE_ROW_BUTTON}>
              <MoreHorizontal aria-hidden className="size-3.75" />
            </DropdownMenuTrigger>
            {/* 줄 아래에서 줄 오른쪽 끝에 맞춰 선다 — 줄의 아래 12에 걸친다(보드 `.pl-menu` — `top: calc(100% - 12px); right: 0`). */}
            <DropdownMenuContent anchor={wrap} side="bottom" align="end" sideOffset={-12} width="place">
              {rowMenu(project).map((item) => {
                const Icon = ROW_ICONS[item.act];
                return (
                  <DropdownMenuItem key={item.act} onClick={() => onAct(item.act)}>
                    <Icon />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {!missing && (
            <>
              <Hint
                text="작업공간 만들기"
                aria-label={`${project.name} 범위로 작업공간 만들기`}
                type="button"
                onClick={() => onStart("work")}
                className={PLACE_ROW_BUTTON}
              >
                <GitBranch aria-hidden className="size-3.5" />
              </Hint>
              <Hint
                text="새 채팅"
                aria-label={`${project.name} 범위로 새 채팅`}
                type="button"
                onClick={() => onStart("thread")}
                className={PLACE_ROW_BUTTON}
              >
                <SquarePen aria-hidden className="size-3.5" />
              </Hint>
            </>
          )}
        </>
      }
    />
  );
}

/** ⋯ 항목의 글리프(보드 `MENUS.projects` — 열린 폴더 · 복사 · 지우기). */
const ROW_ICONS: Record<RowAct, typeof Folder> = { "open-folder": FolderOpen, "copy-path": Copy, remove: Trash2 };
