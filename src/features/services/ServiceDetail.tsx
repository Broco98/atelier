import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { Folder, GitBranch, Layers } from "lucide-react";
import { placeWhen } from "@/components/catalog/place-list";
import { PlaceButton, PlaceDetail, PlaceDetailMenu, PlaceFact, PlaceFacts, PlaceLede, PlaceSection, PlaceWarn } from "@/components/catalog/PlaceDetail";
import { PlaceAdd, PlaceRow } from "@/components/catalog/PlaceList";
import { navItem } from "@/components/shell/nav-items";
import { StatusMark } from "@/components/shell/status-mark";
import { useProjects } from "@/features/projects/hooks";
import { signalsOf } from "@/features/terminal/shell-attention";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useThreads, useWorkMarks } from "@/features/thread/hooks";
import { useWorks } from "@/features/works/hooks";
import { workMark } from "@/features/works/work-mark";
import { workDoor } from "@/routes/-work-search";
import { useService } from "./hooks";
import { SERVICE_ACT_ICONS, shownActs, useServiceActs } from "./ServiceActions";
import { useServiceDelete } from "./ServiceDeleteDialog";
import { problemNotice, serviceFacts, serviceSections } from "./service-detail";
import { serviceName, serviceRowMenu, serviceStarts } from "./service-view";
import type { ServiceDetail as Detail } from "./types";

// **Service 상세**(restart 03-3 · 스펙 「03 — 목록과 상세」 · 스토리 115 – 118 · 보드 MainServiceDetail · PlaceSheet 「문제가 있는 Service」 · Places
// `DETAILS.payments` · `DETAILS.admin`) — 공용 상세 틀(`PlaceDetail`)에 선다. 틀은 `/services`의 것이다(`ServicesPlace`): 머리 줄 「Services / 이름」과
// 본문 카드는 목록과 한 자리를 번갈아 쓰는 틀이 그리고, 여기는 상세의 판만 그린다.
//
//   「← Services」 ─ 언제나 목록으로(창의 뒤로 · 앞으로는 주소의 히스토리라 목록 · 상세 · 그 너머를 오간다)
//   머리 ─ 이름 · 「작업공간 만들기」 · 「+ 새 채팅」(그 Service를 범위로 고른 새 채팅 — 목록 줄의 두 단추와 같은 주소) · ⋯(목록 줄의 ⋯와 같다)
//   설명 · 파일에 문제가 있으면 경고와 「파일로 고치기」(스토리 118 — 몇째 줄인지까지 말한다)
//   위 카드 ─ Project · 작업공간 · 함께 쓰는 Service · 만든 날
//   묶음 ─ Projects(+ 「Project 넣기」 — 그 Service를 고친다는 말이 채워진 새 채팅, 스토리 117) · 작업공간 · 함께 쓰는 Service(`serviceSections`)
//
// - **관계 그래프를 지웠다**(스펙) — 같은 것을 Projects · 함께 쓰는 Service 묶음이 보인다. 한 Project는 여러 Service에 든다(스토리 116) — 그 Project의
//   상세 Service 묶음과 이 상세의 「함께 쓰는 Service」가 그것을 보인다.
// - **파일로 고치기**는 ⋯와 경고에서 닿는다 — 그 Service 파일을 글 그대로 고치는 화면(`/services/$slug/edit`)이다. 한때(03)의 「관계 편집」이다.
// - **보드에 없는 고치기 문이 없다**(restart 03-15c — 소유자 판단 「시안대로」) — 이름 · 설명 · Project는 대화(Runtime의 Service 도구)나 「파일로
//   고치기」로 고친다. 한때(03-3) 제목을 누르거나 ⋯ 「이름 바꾸기」면 이름 칸, ⋯ 「설명 고치기」면 설명 칸이 섰고, Projects 줄을 지나면 ⋯
//   「Service에서 빼기」(「되돌리기」 토스트)가 섰다.
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

function ServiceBody({ service }: { service: Detail }) {
  const navigate = useNavigate();
  const { data: registered = [] } = useProjects();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const marks = useWorkMarks();
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);
  // 상세에서 지우면 목록으로 간다 — 되돌리기 토스트는 목록의 자리에 선다.
  const removing = useServiceDelete(() => void navigate({ to: "/services" }));
  const acts = useServiceActs((one) => void removing.ask(one));

  const name = serviceName(service);
  const starts = serviceStarts(service);
  const notice = problemNotice(service.problems);
  const sections = useMemo(() => serviceSections(service, registered, works, threads), [service, registered, works, threads]);
  // 시각 글은 그린 때의 지금으로 센다(목록과 같다).
  const now = Date.now();

  return (
    <PlaceDetail
      back={BACK()}
      title={name}
      actions={
        <>
          <PlaceButton label="작업공간 만들기" onClick={() => void navigate({ to: "/", search: starts.work })} />
          <PlaceAdd label="새 채팅" onClick={() => void navigate({ to: "/", search: starts.thread })} />
          <PlaceDetailMenu
            label={`${name} 메뉴`}
            items={shownActs(serviceRowMenu(), acts.canCopy)}
            icons={SERVICE_ACT_ICONS}
            onAct={(what) => acts.act(service, what)}
          />
        </>
      }
      after={removing.dialog}
    >
      <PlaceLede>{service.description}</PlaceLede>
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
            actions={null}
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
