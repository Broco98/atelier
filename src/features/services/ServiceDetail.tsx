import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { AlignLeft, Folder, GitBranch, Layers, MoreHorizontal, Pencil, X, type LucideIcon } from "lucide-react";
import { placeWhen } from "@/components/catalog/place-list";
import {
  PLACE_ICON_BUTTON,
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
import { navItem } from "@/components/shell/nav-items";
import { StatusMark } from "@/components/shell/status-mark";
import { showProblem } from "@/components/ui/confirm-store";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineRename } from "@/components/ui/inline-rename";
import { showUndoToast } from "@/components/ui/toast";
import { useProjects } from "@/features/projects/hooks";
import { signalsOf } from "@/features/terminal/shell-attention";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useThreads, useWorkMarks } from "@/features/thread/hooks";
import { useWorks } from "@/features/works/hooks";
import { workMark } from "@/features/works/work-mark";
import { workDoor } from "@/routes/-work-search";
import { cn } from "@/lib/utils";
import { useService, useUpdateService } from "./hooks";
import { SERVICE_ACT_ICONS, shownActs, useServiceActs } from "./ServiceActions";
import { useServiceDelete } from "./ServiceDeleteDialog";
import { problemNotice, serviceFacts, serviceSections } from "./service-detail";
import { editableInPlace, serviceDetailMenu, serviceName, serviceStarts, type ServiceDetailAct } from "./service-view";
import type { ServiceDetail as Detail, ServicePatch } from "./types";

// **Service 상세**(restart 03-3 · 스펙 「03 — 목록과 상세」 · 스토리 115 – 118 · 보드 MainServiceDetail · PlaceSheet 「문제가 있는 Service」 · Places
// `DETAILS.payments` · `DETAILS.admin`) — 공용 상세 틀(`PlaceDetail`)에 선다. 틀은 `/services`의 것이다(`ServicesPlace`): 머리 줄 「Services / 이름」과
// 본문 카드는 목록과 한 자리를 번갈아 쓰는 틀이 그리고, 여기는 상세의 판만 그린다.
//
//   「← Services」 ─ 언제나 목록으로(창의 뒤로 · 앞으로는 주소의 히스토리라 목록 · 상세 · 그 너머를 오간다)
//   머리 ─ 이름 · 「작업공간 만들기」 · 「+ 새 채팅」(그 Service를 범위로 고른 새 채팅 — 목록 줄의 두 단추와 같은 주소) · ⋯
//   설명 · 파일에 문제가 있으면 경고와 「파일로 고치기」(스토리 118 — 몇째 줄인지까지 말한다)
//   위 카드 ─ Project · 작업공간 · 함께 쓰는 Service · 만든 날
//   묶음 ─ Projects(+ 「Project 넣기」 — 그 Service를 고친다는 말이 채워진 새 채팅, 스토리 117) · 작업공간 · 함께 쓰는 Service(`serviceSections`)
//
// - **관계 그래프를 지웠다**(스펙) — 같은 것을 Projects · 함께 쓰는 Service 묶음이 보인다. 한 Project는 여러 Service에 든다(스토리 116) — 그 Project의
//   상세 Service 묶음과 이 상세의 「함께 쓰는 Service」가 그것을 보인다.
// - **파일로 고치기**는 ⋯와 경고에서 닿는다 — 그 Service 파일을 글 그대로 고치는 화면(`/services/$slug/edit`)이다. 한때(03)의 「관계 편집」이다.
// - **칸 단위 고치기는 그대로 두고 들어가는 문만 옮겼다**(Project 상세와 같은 판단 — restart 03-2) — 이름(제목을 누르거나 ⋯ 「이름 바꾸기」) · 설명
//   (⋯ 「설명 고치기」) · Project 빼기(Projects 줄을 지날 때 서는 ⋯ 「Service에서 빼기」 — 「되돌리기」 토스트)는 모두 core 고치기 하나다
//   (`update_service`). 쉴 때의 그림은 보드 그대로다. 칸 단위로 고칠 수 없는 파일(닫히지 않은 frontmatter · YAML이 아님 · 글로 읽을 수 없음)이면
//   그 문들이 서지 않고 파일로만 고친다.
// - 한때(03) 상세는 「← Service」 알약 줄 · 제목 연필과 만든 이 줄 · 관계 그래프 · 설명 묶음 · Project 표 | 오른쪽 칸(함께 쓰는 Service · 작업공간)
//   두 단이었고, 머리에 「대화로 고치기」, Project 표에 등록된 Project를 곧바로 넣는 「넣기」 메뉴가 있었다.

export default function ServiceDetail({ slug }: { slug: string }) {
  const { data: service, isError, error } = useService(slug);
  if (!service) {
    return (
      <PlaceDetail back={BACK()} title={null}>
        {isError && <p className="text-sm text-fg-tertiary">Service를 읽지 못했어요 — {String(error)}</p>}
      </PlaceDetail>
    );
  }
  return <ServiceBody key={service.slug} service={service} />;
}

const BACK = () => ({ to: "/services" as const, label: navItem("services").label });

/** 머리 ⋯(`serviceDetailMenu`) 항목의 글리프 — 고치기(연필 · 글 줄), 그리고 목록 줄의 셋(파일 위 연필 · 복사 · 지우기). */
const MENU_ICONS: Record<ServiceDetailAct, LucideIcon> = { rename: Pencil, describe: AlignLeft, ...SERVICE_ACT_ICONS };

function ServiceBody({ service }: { service: Detail }) {
  const navigate = useNavigate();
  const update = useUpdateService();
  const { data: registered = [] } = useProjects();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const marks = useWorkMarks();
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);
  // 상세에서 지우면 목록으로 간다 — 되돌리기 토스트는 목록의 자리에 선다.
  const removing = useServiceDelete(() => void navigate({ to: "/services" }));
  const acts = useServiceActs((one) => void removing.ask(one));
  const [renaming, setRenaming] = useState(false);
  const [describing, setDescribing] = useState(false);

  const name = serviceName(service);
  const editable = editableInPlace(service);
  const starts = serviceStarts(service);
  const notice = problemNotice(service.problems);
  const sections = useMemo(() => serviceSections(service, registered, works, threads), [service, registered, works, threads]);
  // 시각 글은 그린 때의 지금으로 센다(목록과 같다).
  const now = Date.now();

  const patch = async (change: ServicePatch, failed: string): Promise<boolean> => {
    try {
      await update.mutateAsync({ slug: service.slug, patch: change });
      return true;
    } catch (e) {
      await showProblem(`${failed} — ${e}`);
      return false;
    }
  };
  const drop = async (project: string) => {
    // 되돌리면 제자리로 — 뺀 Project 바로 뒤에 있던 것 앞에 다시 선다(없었으면 끝).
    const next = service.projects[service.projects.indexOf(project) + 1];
    if (!(await patch({ remove: [project] }, "Service에서 빼지 못했어요"))) return;
    showUndoToast(`Service에서 뺐어요 — ${project}`, () => void patch({ add: [project], before: next }, "되돌리지 못했어요"));
  };
  const act = (what: ServiceDetailAct) => {
    if (what === "rename") setRenaming(true);
    else if (what === "describe") setDescribing(true);
    else acts.act(service, what);
  };

  return (
    <PlaceDetail
      back={BACK()}
      title={
        renaming ? (
          // 칸은 이름 글자만큼(최소 352)이다 — 줄의 폭을 다 먹지 않게 줄 안의 상자로 감싼다(Project 상세와 같다).
          <span className="flex min-w-0">
            <InlineRename
              value={name}
              label="Service 이름"
              emptyMeans="revert"
              fit="text"
              onCommit={(next) => void patch({ name: next }, "이름을 바꾸지 못했어요")}
              onDone={() => setRenaming(false)}
              className="-ml-2.5 h-9 min-w-88 items-center rounded-lg px-2.5"
            />
          </span>
        ) : editable ? (
          // 이름을 누르면 그 자리가 입력 칸이 된다 — 쉴 때는 보드의 제목 그대로다.
          <button
            type="button"
            aria-label={`${name} — 이름 바꾸기`}
            onClick={() => setRenaming(true)}
            className="max-w-full rounded-ctl text-left wrap-anywhere focus-ring"
          >
            {name}
          </button>
        ) : (
          name
        )
      }
      actions={
        <>
          <PlaceButton label="작업공간 만들기" onClick={() => void navigate({ to: "/", search: starts.work })} />
          <PlaceAdd label="새 채팅" onClick={() => void navigate({ to: "/", search: starts.thread })} />
          <PlaceDetailMenu label={`${name} 메뉴`} items={shownActs(serviceDetailMenu(service), acts.canCopy)} icons={MENU_ICONS} onAct={act} />
        </>
      }
      after={removing.dialog}
    >
      {describing ? (
        <PlaceLedeEditor
          text={service.description}
          placeholder="이 Service에서 다루는 일과 Project들이 어떻게 이어지는지 적어 두세요"
          note="Runtime이 이 Service에서 일할 때 처음 읽어요"
          onSave={(description) => patch({ description }, "설명을 저장하지 못했어요")}
          onDone={() => setDescribing(false)}
        />
      ) : (
        <PlaceLede>{service.description}</PlaceLede>
      )}
      {notice && <PlaceWarn text={notice} action={{ label: "파일로 고치기", onClick: () => acts.act(service, "edit-file") }} />}
      <PlaceFacts>
        {serviceFacts(service, works).map((fact) => (
          <PlaceFact key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </PlaceFacts>
      {/* Projects 묶음은 넣은 것이 없어도 선다 — 그 머리의 +가 「Project 넣기」의 문이다. */}
      <PlaceSection
        title="Projects"
        count={sections.projects.length}
        add={{ label: "Project 넣기", onClick: () => void navigate({ to: "/", search: starts.addProject }) }}
      >
        {sections.projects.length === 0 && <p className="py-3.5 text-chat-meta text-fg-tertiary">넣은 Project가 없어요</p>}
        {sections.projects.map((row) => (
          <PlaceRow
            key={row.slug}
            size="sub"
            icon={<Folder />}
            name={row.name}
            link={{ to: "/projects/$slug", params: { slug: row.slug } }}
            desc={row.desc}
            when={placeWhen(row.at, now)}
            missing={row.missing}
            onOpen={() => void navigate({ to: "/projects/$slug", params: { slug: row.slug } })}
            actions={editable && <MemberMenu name={row.name} onDrop={() => void drop(row.slug)} />}
          />
        ))}
      </PlaceSection>
      {sections.works.length > 0 && (
        <PlaceSection
          title="작업공간"
          count={sections.works.length}
          add={{ label: "작업공간 만들기", onClick: () => void navigate({ to: "/", search: starts.work }) }}
        >
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
      {sections.shared.length > 0 && (
        <PlaceSection title="함께 쓰는 Service" count={sections.shared.length}>
          {sections.shared.map((row) => (
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

/**
 * Projects 줄의 ⋯ — 「Service에서 빼기」 하나(빼면 「되돌리기」 토스트가 서고, 누르면 제자리에 다시 넣는다). 보드 상세 줄에는 오른쪽 단추가 없다 — 쉴 때는
 * 보이지 않고 줄을 지나거나 키로 서거나 열렸을 때만 선다. 칸 단위로 고칠 수 없는 파일이면 서지 않는다(파일로 고친다).
 */
function MemberMenu({ name, onDrop }: { name: string; onDrop: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name} 메뉴`}
        className={cn(PLACE_ICON_BUTTON, "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100")}
      >
        <MoreHorizontal aria-hidden className="size-3.75" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="place">
        <DropdownMenuItem onClick={onDrop}>
          <X />
          <span>Service에서 빼기</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
