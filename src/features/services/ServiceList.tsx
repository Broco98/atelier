import { useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { GitBranch, Layers, Plus, SquareM, SquarePen } from "lucide-react";
import { HeadCrumb } from "@/components/catalog/DetailParts";
import { FIRST_SORT, nextSort, placeWhen, sortPlaces, type PlaceSort } from "@/components/catalog/place-list";
import {
  PLACE_ROW_BUTTON,
  PlaceEmpty,
  PlaceList,
  PlaceRow,
  PlaceSearch,
  PlaceSkeleton,
  PlaceStage,
  PlaceTable,
  useLate,
} from "@/components/catalog/PlaceList";
import { navItem } from "@/components/shell/nav-items";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import { useThreads } from "@/features/thread/hooks";
import { useWorks } from "@/features/works/hooks";
import { cn } from "@/lib/utils";
import { useServices } from "./hooks";
import { ServiceRowMenu, useServiceActs } from "./ServiceActions";
import { useServiceDelete } from "./ServiceDeleteDialog";
import { serviceActivity } from "./service-activity";
import { HOST_MAKE, listShows, serviceName, serviceStarts, serviceSummary, shownServices } from "./service-view";
import type { ServiceAct } from "./service-view";
import type { Service } from "./types";

// **Services**(restart 03-3 · 스펙 「03 — 목록과 상세」 · 스토리 8 · 13 · 107 – 113 · 보드 MainServices · PlaceSheet · Places `DATA.services`) — 사이드바 위 칸
// 「Services」가 여는 자리다. Projects와 같은 공용 목록 틀(`PlaceList`)이고, 목록과 상세(`/services/$slug`)가 한 자리를 번갈아 쓴다(`PlaceStage`) — 이
// 라우트(`/services`)가 둘의 틀이라 상세에 가 있는 동안에도 목록은 마운트된 채 숨어, 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로다.
//
//   머리 줄 ─ 목록은 「Services」, 상세는 「Services / 이름」(눌러 목록으로)
//   목록 ─ 제목 · 「Service 찾기」 · 「+ 만들기」, 이름(Project 수와 이름) · 최근 활동 · 오른쪽 동작(⋯ · 작업공간 만들기 · 새 채팅)
//
// - **최근 활동**은 작업공간과 채팅의 활동에서 짓고 저장하지 않는다(`serviceActivity` — 그 Service를 쓰는 작업공간의 채팅과 그 Service 범위의 작업공간
//   밖 채팅). 처음 차례는 최근 활동 순이다.
// - **줄의 「작업공간 만들기」 · 「새 채팅」**은 그 Service를 범위로 고른 새 채팅을 연다(`?new=work&service=` · `?new=thread&service=`).
// - **「+ 만들기」**는 두 길의 메뉴다 — 「대화로 만들기」(기본 — 작업공간 없는 새 채팅에 맡기는 말을 넣어 연다, S16)와 「직접 만들기」(빈 틀의 Service
//   파일을 고치기 화면에 연다 — `/services/new`). 보드는 단추만 그렸다.
// - 파일은 바깥에서도 고치므로 `services:changed`를 듣는다(`useServices`). 지우기는 확인 창과 「되돌리기」 토스트(`useServiceDelete`)다.
// - 한때(03) 표가 이름 · Project · 설명 세 칸(줄 48)이었고, 이름 뒤에 「문제 있음」, 표 아래에 「Service는 Project를 묶어요 …」 한 줄이 섰다(`ListParts`).

/** `/services`의 틀 — 머리 줄과 목록 · 상세의 자리. 상세는 자식 라우트(`/services/$slug`)가 그린다. */
export default function ServicesPlace() {
  const { slug } = useParams({ strict: false });
  const { data: services = [] } = useServices();
  const navigate = useNavigate();
  const label = navItem("services").label;
  const detail = slug === undefined ? null : (services.find((one) => one.slug === slug) ?? null);
  return (
    <PlainFrame
      label={slug === undefined ? label : `${label} 상세`}
      lead={slug !== undefined && <HeadCrumb label={label} onOpen={() => void navigate({ to: "/services" })} />}
      title={slug === undefined ? { name: label } : detail ? { name: serviceName(detail) } : undefined}
    >
      <PlaceStage list={<ServiceList />} detail={<Outlet />} detailKey={slug ?? null} />
    </PlainFrame>
  );
}

/** Services 목록 — 찾기 · 정렬 · 줄. 상세에 가 있는 동안에도 마운트된 채라 이 상태가 남는다. */
function ServiceList() {
  const { data: services = [], isPending, isError, error } = useServices();
  const { data: projects = [] } = useProjects();
  const { data: works = [] } = useWorks();
  const { data: threads = [] } = useThreads();
  const navigate = useNavigate();
  const removing = useServiceDelete();
  const acts = useServiceActs((service) => void removing.ask(service));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PlaceSort>(FIRST_SORT);
  const shows = listShows({ isPending, isError, count: services.length });
  const late = useLate(shows === "loading");
  const label = navItem("services").label;

  const activity = useMemo(() => serviceActivity(services.map((one) => one.slug), works, threads), [services, works, threads]);
  const rows = useMemo(
    () => sortPlaces(shownServices(services, query), sort, serviceName, (one) => activity[one.slug] ?? null),
    [services, query, sort, activity],
  );
  // 시각 글은 그린 때의 지금으로 센다 — 목록에 돌아오거나 줄이 바뀌면 새로 센다.
  const now = Date.now();

  const open = (slug: string) => void navigate({ to: "/services/$slug", params: { slug } });
  const needle = query.trim();
  return (
    <PlaceList
      title={label}
      tools={
        // 찾기 · 만들기는 목록이 있을 때만 — 빈 목록은 가운데 할 일이 「만들기」를 들고, 처음 읽는 동안은 제목뿐이다(보드 `showTools`).
        shows === "table" && (
          <>
            <PlaceSearch label="Service 찾기" value={query} onChange={setQuery} />
            <MakeService />
          </>
        )
      }
      after={removing.dialog}
    >
      {shows === "error" ? (
        <p className="py-6 text-sm text-fg-tertiary">Service 목록을 읽지 못했어요 — {String(error)}</p>
      ) : shows === "loading" ? (
        late && <PlaceSkeleton whenLabel="최근 활동" />
      ) : shows === "empty" ? (
        <PlaceEmpty
          icon={<Layers />}
          title="아직 Service가 없어요"
          body="함께 고치는 Project를 하나로 묶으면, 그 묶음을 범위로 채팅과 작업공간을 시작할 수 있어요."
          action={<MakeService className="mt-1.5" />}
        />
      ) : (
        <PlaceTable
          label="Service 목록"
          whenLabel="최근 활동"
          sort={sort}
          onSort={(key) => setSort((held) => nextSort(held, key))}
          empty={rows.length === 0 ? `「${needle}」와 맞는 Service가 없어요` : null}
        >
          {rows.map((service) => (
            <ServiceRow
              key={service.slug}
              service={service}
              desc={serviceSummary(service, projects)}
              when={placeWhen(activity[service.slug] ?? null, now)}
              canCopy={acts.canCopy}
              onOpen={() => open(service.slug)}
              onStart={(search) => void navigate({ to: "/", search })}
              onAct={(what) => acts.act(service, what)}
            />
          ))}
        </PlaceTable>
      )}
    </PlaceList>
  );
}

/**
 * 「+ 만들기」(보드 `.pl-btn.main` — 34 · 완전히 둥글게 · 면 `fg`) — 두 길의 메뉴를 연다(F4-SpaceNewMenu — 단추 오른쪽 끝에 맞춰 아래 6). 「대화로
 * 만들기」(끝에 「기본」)는 첫 화면을 작업공간 없는 새 채팅과 맡기는 말로 열고 보내기는 사람이 한다(S16), 「직접 만들기」는 빈 틀의 고치기 화면이다.
 * 머리와 빈 목록의 할 일이 같은 단추다.
 */
function MakeService({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      {/* `Button`처럼 `cn`으로 겹친 크기를 걷는다 — 날 `buttonVariants`면 기본 글리프 16이 남아 보드(+ 15)보다 1 넓다. */}
      <DropdownMenuTrigger className={cn(buttonVariants({ size: "place" }), "hover:opacity-86", className)}>
        <Plus aria-hidden />
        만들기
      </DropdownMenuTrigger>
      {/* 폭은 308이고 설명은 낱말 단위로 두 줄에 접힌다(F4-SpaceNewMenu `.pop{min-width:300px}` — 단추에 붙은 칸이라 내용 폭으로 넓어지지 않는다). */}
      <DropdownMenuContent side="bottom" align="end" sideOffset={6} width="note-fold">
        <DropdownMenuItem
          size="note"
          aria-label="대화로 만들기"
          aria-description="Project를 읽고 초안을 내요 — 승인하면 만들어져요"
          onClick={() => void navigate({ to: "/", search: HOST_MAKE })}
        >
          <SquarePen className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">대화로 만들기</span>
            <span className="text-xs break-keep text-fg-tertiary">Project를 읽고 초안을 내요 — 승인하면 만들어져요</span>
          </span>
          <span className="shrink-0 pl-3 text-xs text-fg-tertiary">기본</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          size="note"
          aria-label="직접 만들기"
          aria-description="Service 파일을 빈 틀로 열어요 — 이름과 Project를 적어요"
          onClick={() => void navigate({ to: "/services/new" })}
        >
          <SquareM className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">직접 만들기</span>
            <span className="text-xs break-keep text-fg-tertiary">Service 파일을 빈 틀로 열어요 — 이름과 Project를 적어요</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 줄 하나(보드 Places 줄 · 스토리 8 · 13) — Service 글리프 · 이름 · Project 수와 이름, 최근 활동, 오른쪽에 ⋯ · 작업공간 만들기 · 새 채팅. 줄 어디를
 * 눌러도 상세다 — 이름이 그 링크이고, 오른쪽 단추는 제 일만 한다(`PlaceRow`).
 */
function ServiceRow({
  service,
  desc,
  when,
  canCopy,
  onOpen,
  onStart,
  onAct,
}: {
  service: Service;
  desc: string;
  when: string;
  canCopy: boolean;
  onOpen: () => void;
  onStart: (search: ReturnType<typeof serviceStarts>["work"]) => void;
  onAct: (what: ServiceAct) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const name = serviceName(service);
  const starts = serviceStarts(service);
  return (
    <PlaceRow
      anchor={wrap}
      icon={<Layers />}
      name={name}
      link={{ to: "/services/$slug", params: { slug: service.slug } }}
      desc={desc}
      when={when}
      onOpen={onOpen}
      actions={
        <>
          <ServiceRowMenu service={service} anchor={wrap} canCopy={canCopy} onAct={onAct} />
          <Hint
            text="작업공간 만들기"
            aria-label={`${name} 범위로 작업공간 만들기`}
            type="button"
            onClick={() => onStart(starts.work)}
            className={PLACE_ROW_BUTTON}
          >
            <GitBranch aria-hidden className="size-3.5" />
          </Hint>
          <Hint text="새 채팅" aria-label={`${name} 범위로 새 채팅`} type="button" onClick={() => onStart(starts.thread)} className={PLACE_ROW_BUTTON}>
            <SquarePen aria-hidden className="size-3.5" />
          </Hint>
        </>
      }
    />
  );
}
