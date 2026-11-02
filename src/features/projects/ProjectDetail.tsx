import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { AlignLeft, Copy, FolderOpen, GitBranch, Layers, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { placeDay, placeWhen } from "@/components/catalog/place-list";
import {
  PLACE_FACT,
  PLACE_FACT_LABEL,
  PLACE_FACT_VALUE,
  PlaceButton,
  PlaceDetail,
  PlaceDetailMenu,
  PlaceFact,
  PlaceFacts,
  PlaceLede,
  PlaceLedeEditor,
  PlaceSection,
  PlaceWarn,
} from "@/components/catalog/PlaceDetail";
import { PlaceAdd, PlaceRow } from "@/components/catalog/PlaceList";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { StatusMark } from "@/components/shell/status-mark";
import { showProblem } from "@/components/ui/confirm-store";
import { InlineRename } from "@/components/ui/inline-rename";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { useServices } from "@/features/services/hooks";
import { signalsOf } from "@/features/terminal/shell-attention";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useThreads, useWorkMarks } from "@/features/thread/hooks";
import { projectDirRef } from "@/features/works/refs";
import { useWorks } from "@/features/works/hooks";
import { workMark } from "@/features/works/work-mark";
import { startSearch } from "@/routes/-new-thread-search";
import { workDoor } from "@/routes/-work-search";
import { projectsApi } from "./api";
import { useProjects, useUpdateProject } from "./hooks";
import { projectSections } from "./project-detail";
import { baseNote, branchGroups, detailMenu, missingNotice, renameHint, type DetailAct } from "./project-view";
import { useProjectRemoval } from "./ProjectRemoveDialog";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// **Project 상세**(restart 03-2 · 스펙 「03 — 목록과 상세」 · 스토리 114 · 119 · 보드 MainProjectDetail · PlaceSheet 「상세 상태」 · Places `DETAILS`) —
// 공용 상세 틀(`PlaceDetail`)에 선 첫 화면이다. 틀은 `/projects`의 것이다(restart 03-1 — `ProjectsPlace`): 머리 줄 「Projects / 이름」과 본문 카드는
// 목록과 한 자리를 번갈아 쓰는 틀이 그리고, 여기는 상세의 판만 그린다.
//
//   「← Projects」 ─ 언제나 목록으로(창의 뒤로 · 앞으로는 주소의 히스토리라 목록 · 상세 · 그 너머를 오간다)
//   머리 ─ 이름 · 「작업공간 만들기」 · 「+ 새 채팅」(그 Project를 범위로 고른 새 채팅 — 목록 줄의 두 단추와 같은 주소) · ⋯
//   설명 · 폴더를 찾을 수 없으면 경고와 「재설정」(스토리 119 — ⋯ 안이 아니라 여기서 바로)
//   위 카드 ─ 경로 · 기준 브랜치 · 원격 · 추가한 날
//   묶음 ─ 작업공간 · 채팅 · Service(`projectSections` — 「상세에 Work 묶음을 두지 않는다」(S21)를 뒤집는다). 줄이 없는 묶음은 서지 않는다
//
// **고치기는 그대로다** — 이름(제목을 누르거나 ⋯ 「이름 바꾸기」) · 설명(⋯ 「설명 고치기」) · 기준 브랜치(그 카드를 누르면 목록)는 모두 core 고치기
// 하나다(`update_project`). 보드 상세에는 고치는 자리가 그려지지 않았다 — 쉴 때의 그림은 보드 그대로이고 문만 남겼다. 이름을 바꿔도 slug(파일
// 이름) · 경로는 그대로이고, 기준 브랜치는 그 저장소의 로컬 · 원격 목록에서만 고른다(core가 목록에 없는 값을 거절한다). 경로는 「재설정」으로만
// 바뀐다. 한때(03) 상세는 제목 · 설명 묶음 | 오른쪽 칸(기준 브랜치 · 경로) 두 단이었고 Work 묶음이 없었다.

export default function ProjectDetail({ slug }: { slug: string }) {
  const { data: projects = [], isPending, isFetching } = useProjects();
  const project = projects.find((one) => one.slug === slug) ?? null;
  const navigate = useNavigate();

  // 보던 Project가 목록에서 빠졌다(이 상세의 ⋯ · 다른 창 · 바깥에서 제거) — 목록으로 간다. 빈 상세가 남으면 뒤로가기 한 번이 아무 일도 하지
  // 않으니 이 칸을 갈아 쓴다(replace).
  const gone = !isPending && !isFetching && project === null;
  useEffect(() => {
    if (gone) void navigate({ to: "/projects", replace: true });
    // navigate는 의존성에 넣지 않는다 — 라우터가 고정해 준다
  }, [gone]);

  if (!project) return <PlaceDetail back={BACK()} title={null}>{null}</PlaceDetail>;
  return <ProjectBody key={project.slug} project={project} />;
}

const BACK = () => ({ to: "/projects" as const, label: navItem("projects").label });

function ProjectBody({ project }: { project: ProjectView }) {
  const navigate = useNavigate();
  const update = useUpdateProject();
  const relocate = useRelocate();
  const removing = useProjectRemoval();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const { data: services = [] } = useServices();
  const marks = useWorkMarks();
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);
  const [renaming, setRenaming] = useState(false);
  const [describing, setDescribing] = useState(false);

  const sections = useMemo(() => projectSections(project.slug, works, threads, services), [project.slug, works, threads, services]);
  // 시각 글은 그린 때의 지금으로 센다(목록과 같다).
  const now = Date.now();

  const patch = async (change: Parameters<typeof update.mutateAsync>[0]["patch"], failed: string): Promise<boolean> => {
    try {
      await update.mutateAsync({ slug: project.slug, patch: change });
      return true;
    } catch (e) {
      await showProblem(`${failed} — ${e}`);
      return false;
    }
  };
  const start = (what: "work" | "thread") => void navigate({ to: "/", search: startSearch(what, { project: project.slug }) });
  const act = (what: DetailAct) => {
    if (what === "rename") setRenaming(true);
    else if (what === "describe") setDescribing(true);
    else if (what === "open-folder") openInFinder(() => projectsApi.openFolder(project.slug));
    else if (what === "copy-path") copyText(projectDirRef(project.path));
    else void removing.ask(project);
  };

  return (
    <PlaceDetail
      back={BACK()}
      title={
        renaming ? (
          // 칸은 이름 글자만큼(최소 352)이다 — 줄의 폭을 다 먹지 않게 줄 안의 상자로 감싼다.
          <span className="flex min-w-0">
            <InlineRename
              value={project.name}
              label="Project 이름"
              emptyMeans="revert"
              fit="text"
              onCommit={(name) => void patch({ name }, "이름을 바꾸지 못했어요")}
              onDone={() => setRenaming(false)}
              className="-ml-2.5 h-9 min-w-88 items-center rounded-lg px-2.5"
            />
          </span>
        ) : (
          // 이름을 누르면 그 자리가 입력 칸이 된다(스토리 122) — 쉴 때는 보드의 제목 그대로다.
          <button
            type="button"
            aria-label={`${project.name} — 이름 바꾸기`}
            onClick={() => setRenaming(true)}
            className="max-w-full rounded-ctl text-left wrap-anywhere focus-ring"
          >
            {project.name}
          </button>
        )
      }
      actions={
        <>
          <PlaceButton label="작업공간 만들기" onClick={() => start("work")} />
          <PlaceAdd label="새 채팅" onClick={() => start("thread")} />
          <PlaceDetailMenu label={`${project.name} 메뉴`} items={detailMenu(project)} icons={MENU_ICONS} onAct={act} />
        </>
      }
      after={removing.dialog}
    >
      {renaming && <p className="mb-2 text-xs text-fg-tertiary">{renameHint(project)}</p>}
      {describing ? (
        <PlaceLedeEditor
          text={project.description}
          placeholder="이 Project가 무엇인지 한두 줄로 적어 두세요"
          note="Runtime이 이 Project를 이해할 때 읽어요"
          onSave={(description) => patch({ description }, "설명을 저장하지 못했어요")}
          onDone={() => setDescribing(false)}
        />
      ) : (
        <PlaceLede>{project.description}</PlaceLede>
      )}
      {project.missing && <PlaceWarn text={missingNotice()} action={{ label: "재설정", onClick: () => void relocate(project) }} />}
      <PlaceFacts>
        <PlaceFact label="경로" value={project.path} />
        <BaseBranch project={project} onPick={(baseBranch) => patch({ baseBranch }, "기준 브랜치를 바꾸지 못했어요")} />
        <PlaceFact label="원격" value={project.git?.remoteSlug ?? "—"} />
        <PlaceFact label="추가한 날" value={placeDay(project.createdAt)} />
      </PlaceFacts>
      {sections.works.length > 0 && (
        <PlaceSection title="작업공간" count={sections.works.length} add={{ label: "작업공간 만들기", onClick: () => start("work") }}>
          {sections.works.map((row) => (
            <PlaceRow
              key={row.slug}
              size="sub"
              icon={<GitBranch />}
              name={row.name}
              // 그 작업공간의 마지막 화면으로 간다 — 다른 문(사이드바 · ⌘K)과 같은 주소다(`workDoor`).
              link={workDoor(row.slug)}
              desc={row.desc}
              when={placeWhen(row.at, now)}
              onOpen={() => void navigate(workDoor(row.slug))}
              actions={<StatusMark kind={workMark(marks[row.slug] ?? [], signals[row.slug] ?? null)} />}
            />
          ))}
        </PlaceSection>
      )}
      {sections.chats.length > 0 && (
        <PlaceSection title="채팅" count={sections.chats.length} add={{ label: "새 채팅", onClick: () => start("thread") }}>
          {sections.chats.map((row) => (
            <PlaceRow
              key={row.id}
              size="sub"
              icon={<MessageSquare />}
              name={row.name}
              link={{ to: "/threads/$id", params: { id: row.id } }}
              desc={row.desc}
              when={placeWhen(row.at, now)}
              onOpen={() => void navigate({ to: "/threads/$id", params: { id: row.id } })}
              actions={null}
            />
          ))}
        </PlaceSection>
      )}
      {sections.services.length > 0 && (
        <PlaceSection title="Service" count={sections.services.length}>
          {sections.services.map((row) => (
            <PlaceRow
              key={row.slug}
              size="sub"
              icon={<Layers />}
              name={row.name}
              link={{ to: "/services/$slug", params: { slug: row.slug } }}
              desc={row.desc}
              when={placeWhen(row.at, now)}
              onOpen={() => void navigate({ to: "/services/$slug", params: { slug: row.slug } })}
              actions={null}
            />
          ))}
        </PlaceSection>
      )}
    </PlaceDetail>
  );
}

/** 머리 ⋯(`detailMenu`) 항목의 글리프 — 고치기(연필 · 글 줄), 그리고 목록 줄의 셋(열린 폴더 · 복사 · 지우기). */
const MENU_ICONS: Record<DetailAct, typeof Pencil> = {
  rename: Pencil,
  describe: AlignLeft,
  "open-folder": FolderOpen,
  "copy-path": Copy,
  remove: Trash2,
};

/**
 * 기준 브랜치 카드(스토리 119–121 · 125) — 위 카드 한 칸의 겉 그대로이고, 누르면 목록이 「로컬」 · 「원격 — origin」 묶음으로 선다(아래 「새 작업공간의
 * 브랜치가 여기서 갈라져요 · 목록에 있는 브랜치만 고를 수 있어요」). 목록 밖 값 · 빈 값을 적는 칸은 없다. 원격 브랜치를 고르면 그 이름 그대로
 * (`origin/release/2.5`) 적힌다(S19). 바꾸면 그 뒤의 일을 토스트가 말한다. 폴더를 찾을 수 없으면 눌리지 않는다(카드는 그대로 선다 — 보드).
 * 고를 수 있다는 표시(▾)는 지나거나 키로 서거나 열렸을 때만 선다 — 쉴 때는 보드의 카드 그대로다.
 */
function BaseBranch({ project, onPick }: { project: ProjectView; onPick: (branch: string) => Promise<boolean> }) {
  const groups = branchGroups(project.git);
  return (
    <Select
      value={project.baseBranch}
      disabled={project.missing}
      onValueChange={(branch) => {
        // 값이 바뀔 때만 저장한다 — 지금 값을 다시 고른 것은 닫기만 한다.
        if (typeof branch === "string" && branch !== project.baseBranch) {
          void onPick(branch).then((ok) => ok && showToast(baseNote({ ...project, baseBranch: branch }, true)));
        }
      }}
    >
      <SelectTrigger
        aria-label="기준 브랜치"
        className={`${PLACE_FACT} relative h-auto w-full text-chat-meta whitespace-normal text-fg disabled:pointer-events-none disabled:cursor-default disabled:opacity-100 [&>svg:last-child]:absolute [&>svg:last-child]:top-3.5 [&>svg:last-child]:right-3.5 [&>svg:last-child]:opacity-0 hover:[&>svg:last-child]:opacity-100 focus-visible:[&>svg:last-child]:opacity-100 aria-expanded:[&>svg:last-child]:opacity-100`}
      >
        <span className={PLACE_FACT_LABEL}>기준 브랜치</span>
        <span className={PLACE_FACT_VALUE}>{project.baseBranch}</span>
      </SelectTrigger>
      <SelectContent
        className="w-62.5"
        footer={
          <p className="flex flex-col px-3.5 pt-1 pb-2.5 text-xs text-fg-tertiary">
            <span>{baseNote(project, false)}</span>
            <span>목록에 있는 브랜치만 고를 수 있어요</span>
          </p>
        }
      >
        {groups.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 && <SelectSeparator className="mx-1.5 h-[0.5px] bg-separator" />}
            <SelectGroup className="p-0">
              <SelectLabel className="px-2 pt-1.5 pb-1 text-xs text-fg-tertiary">{group.label}</SelectLabel>
              {group.branches.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  <span className="flex min-w-0 items-center gap-2">
                    <GitBranch aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
                    <span className="min-w-0 truncate font-mono text-xs">{branch}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
