import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { Copy, FolderOpen, GitBranch, Layers, MessageSquare, Trash2, type LucideIcon } from "lucide-react";
import { placeDay, placeWhen } from "@/components/catalog/place-list";
import {
  PlaceButton,
  PlaceDetail,
  PlaceDetailMenu,
  PlaceFact,
  PlaceFacts,
  PlaceLede,
  PlaceSection,
  PlaceWarn,
} from "@/components/catalog/PlaceDetail";
import { PlaceAdd, PlaceRow } from "@/components/catalog/PlaceList";
import { copyText } from "@/components/shell/copy-text";
import { navItem } from "@/components/shell/nav-items";
import { openInFinder } from "@/components/shell/open-in-finder";
import { StatusMark } from "@/components/shell/status-mark";
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
import { useProjects } from "./hooks";
import { projectSections } from "./project-detail";
import { missingNotice, rowMenu, type RowAct } from "./project-view";
import { useProjectRemoval } from "./ProjectRemoveDialog";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// **Project 상세**(restart 03-2 · 스펙 「03 — 목록과 상세」 · 스토리 114 · 119 · 보드 MainProjectDetail · PlaceSheet 「상세 상태」 · Places `DETAILS`) —
// 공용 상세 틀(`PlaceDetail`)에 선 첫 화면이다. 틀은 `/projects`의 것이다(restart 03-1 — `ProjectsPlace`): 머리 줄 「Projects / 이름」과 본문 카드는
// 목록과 한 자리를 번갈아 쓰는 틀이 그리고, 여기는 상세의 판만 그린다.
//
//   「← Projects」 ─ 언제나 목록으로(창의 뒤로 · 앞으로는 주소의 히스토리라 목록 · 상세 · 그 너머를 오간다)
//   머리 ─ 이름 · 「작업공간 만들기」 · 「+ 새 채팅」(그 Project를 범위로 고른 새 채팅 — 목록 줄의 두 단추와 같은 주소) · ⋯(목록 줄의 ⋯와 같다)
//   설명 · 폴더를 찾을 수 없으면 경고와 「재설정」(스토리 119 — ⋯ 안이 아니라 여기서 바로)
//   위 카드 ─ 경로 · 기준 브랜치 · 원격 · 추가한 날
//   묶음 ─ 작업공간 · 채팅 · Service(`projectSections` — 「상세에 Work 묶음을 두지 않는다」(S21)를 뒤집는다). 줄이 없는 묶음은 서지 않는다
//
// **보드에 없는 고치기 문이 없다**(restart 03-15c — 소유자 판단 「시안대로」) — 이름 · 설명 · 기준 브랜치는 대화로 고친다(MCP `atelier_edit_project` ·
// Runtime의 설정 도구 — 둘 다 core `update_project`다). 경로는 「재설정」으로만 바뀐다. 한때(03-2) 제목을 누르거나 ⋯ 「이름 바꾸기」면 이름 칸,
// ⋯ 「설명 고치기」면 설명 칸, 기준 브랜치 카드를 누르면 목록이 섰다. 그 앞(03)은 제목 · 설명 묶음 | 오른쪽 칸(기준 브랜치 · 경로) 두 단이었고
// Work 묶음이 없었다.

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
  const relocate = useRelocate();
  const removing = useProjectRemoval();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const { data: services = [] } = useServices();
  const marks = useWorkMarks();
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);

  const sections = useMemo(() => projectSections(project.slug, works, threads, services), [project.slug, works, threads, services]);
  // 시각 글은 그린 때의 지금으로 센다(목록과 같다).
  const now = Date.now();

  const start = (what: "work" | "thread") => void navigate({ to: "/", search: startSearch(what, { project: project.slug }) });
  const act = (what: RowAct) => {
    if (what === "open-folder") openInFinder(() => projectsApi.openFolder(project.slug));
    else if (what === "copy-path") copyText(projectDirRef(project.path));
    else void removing.ask(project);
  };

  return (
    <PlaceDetail
      back={BACK()}
      title={project.name}
      actions={
        <>
          <PlaceButton label="작업공간 만들기" onClick={() => start("work")} />
          <PlaceAdd label="새 채팅" onClick={() => start("thread")} />
          <PlaceDetailMenu label={`${project.name} 메뉴`} items={rowMenu(project)} icons={MENU_ICONS} onAct={act} />
        </>
      }
      after={removing.dialog}
    >
      <PlaceLede>{project.description}</PlaceLede>
      {project.missing && <PlaceWarn text={missingNotice()} action={{ label: "재설정", onClick: () => void relocate(project) }} />}
      <PlaceFacts>
        <PlaceFact label="경로" value={project.path} />
        <PlaceFact label="기준 브랜치" value={project.baseBranch} />
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

/** 머리 ⋯ 항목의 글리프 — 목록 줄의 ⋯와 같다(열린 폴더 · 복사 · 지우기). */
const MENU_ICONS: Record<RowAct, LucideIcon> = { "open-folder": FolderOpen, "copy-path": Copy, remove: Trash2 };
