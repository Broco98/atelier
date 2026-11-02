import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Book, ChevronDown, ChevronRight, Layers, Plus, SquareM, SquarePen } from "lucide-react";
import { ListPanel, ListRow, ListTable, SearchPill } from "@/components/catalog/ListParts";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useServices } from "./hooks";
import { ServiceActions } from "./ServiceActions";
import { useServiceDelete } from "./ServiceDeleteDialog";
import { HOST_MAKE, listShows, shownServices, serviceName } from "./service-view";
import type { Service } from "./types";

// Service 목록(03 구현 스펙 §14 · 시안 F1-Space) — 사람 메뉴 「Service」가 여는 화면이다. 머리 줄 「Service」, 판 안에 제목 · 찾기 칸과 표(이름 ·
// Project · 설명), 표 아래 한 줄 안내. 줄을 누르면 상세다. 문제가 있는 Service도 이름 뒤 「문제 있음」으로 선다(스토리 185). 파일은 바깥에서도
// 고치므로 `services:changed`를 듣는다(`useServices`). 판 · 찾기 칸 · 표 · 줄의 꼴은 Projects 목록과 같은 것이다(`@/components/catalog` — 03 코드
// 리뷰 D1), 찾기의 규칙은 `shownServices`다.
//
// 머리 줄 「새 Service ⌄」는 두 길의 메뉴다(§14 · F4-SpaceNewMenu) — 「대화로 만들기」(기본 — Work 없는 새 대화에 맡기는 말을 넣어 연다, S16)와
// 「직접 만들기」(빈 틀의 Service 파일을 고치기 화면에 연다 — `/services/new`, 04). 줄 끝 ⋯는 「관계 편집 · 삭제…」다(07) — 지우면 확인 창을
// 거쳐 「… Service를 지웠어요 · 되돌리기」 토스트가 본문 아래 가운데 선다(상세에서 지우고 목록으로 와도 같은 자리다).

/** 표의 칸 — 이름 · Project · 설명 · 끝 칸(⋯ 자리). 머리 줄과 몸 줄이 같은 격자다(시안 `.th` · `.srow`). */
const COLUMNS = "grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)_28px] items-center gap-4 pr-2.5 pl-3.5";

export default function ServiceList() {
  const { data: services = [], isPending, isError, error } = useServices();
  const shows = listShows({ isPending, isError, count: services.length });
  const [query, setQuery] = useState("");
  const shown = useMemo(() => shownServices(services, query), [services, query]);
  const label = navItem("services").label;
  const removing = useServiceDelete();

  return (
    <PlainFrame label={label} title={{ name: label }}>
      <ListPanel
        title={label}
        tools={
          <>
            <SearchPill label="Service 찾기" value={query} onChange={setQuery} />
            <NewServiceButton />
          </>
        }
        after={removing.dialog}
      >
        {shows === "error" ? (
          <p className="px-3.5 py-6 text-sm text-fg-tertiary">Service 목록을 읽지 못했어요 — {String(error)}</p>
        ) : shows === "empty" ? (
          // S15 — 빈 목록은 안내 한 줄과 「새 Service」(머리 줄과 같은 길)다.
          <div className="flex flex-col items-start gap-3 px-3.5 py-6">
            <p className="text-sm text-fg-tertiary">아직 Service가 없어요</p>
            <NewServiceButton />
          </div>
        ) : (
          <ListTable label="Service 목록" columns={COLUMNS} heads={["이름", "Project", "설명"]}>
            {shown.map((service) => (
              <ServiceRow key={service.slug} service={service} onDelete={(one) => void removing.ask(one)} />
            ))}
          </ListTable>
        )}
        <p className="px-3.5 text-xs text-fg-tertiary">Service는 Project를 묶어요. Runtime은 Service 안의 Project를 함께 읽어요.</p>
      </ListPanel>
    </PlainFrame>
  );
}

/**
 * 「새 Service ⌄」 — 짙은 알약(시안 F1-Space `.btn.pri`)이 메뉴를 연다(F4-SpaceNewMenu — 단추 오른쪽 끝에 맞춰 아래 6). 「대화로 만들기」(끝에
 * 「기본」)는 첫 화면을 「Work 없이 대화」와 맡기는 말로 열고 보내기는 사람이 한다(S16), 「직접 만들기」는 빈 틀의 고치기 화면이다.
 */
function NewServiceButton() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ size: "top", className: "shrink-0 rounded-full" })}>
        <Plus aria-hidden />새 Service
        <ChevronDown aria-hidden className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      {/* 폭은 시안 그대로 308이고 설명은 낱말 단위로 두 줄에 접힌다(F4-SpaceNewMenu `.pop{min-width:300px}` — 단추에 붙은 칸이라 내용 폭으로 넓어지지 않는다). */}
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
 * 표의 줄 하나(시안 `.srow`) — 줄의 꼴 · 누름은 `ListRow`다(지나면 옅은 면과 이름 끝 꺾쇠가 서고 그 줄의 위 선과 다음 줄의 위 선이 숨는다). 줄
 * 어디를 눌러도 상세다 — 이름이 그 링크이고(키보드는 이름에 선다), 끝의 ⋯는 제 일만 한다.
 */
function ServiceRow({ service, onDelete }: { service: Service; onDelete: (service: Service) => void }) {
  const problems = service.problems.length > 0;
  const navigate = useNavigate();
  return (
    <ListRow columns={COLUMNS} onOpen={() => void navigate({ to: "/services/$slug", params: { slug: service.slug } })}>
      <span role="cell" className="flex min-w-0 items-center">
        {/* WebKit의 Tab은 맨 링크에 서지 않는다 — `tabIndex`를 명시한다(`ProjectsPage`의 줄 이름과 같다). */}
        <Link
          to="/services/$slug"
          params={{ slug: service.slug }}
          tabIndex={0}
          className="-mx-1 flex min-w-0 items-center gap-2.5 rounded-md px-1 focus-ring"
        >
          <Layers aria-hidden className="size-4 shrink-0 text-fg-icon" />
          <span className="min-w-0 truncate">{serviceName(service)}</span>
          {problems && <span className="tag text-xs text-fg-problem">문제 있음</span>}
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-row-act opacity-0 group-hover/row:opacity-100" />
        </Link>
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-chat-meta whitespace-nowrap text-fg-secondary">
        {service.projects.map((project) => (
          <span key={project} className="inline-flex items-center gap-1">
            <Book aria-hidden className="size-3 shrink-0 text-fg-subtle" />
            {project}
          </span>
        ))}
      </span>
      <span role="cell" className="line-clamp-2 text-xs text-fg-tertiary">
        {service.description}
      </span>
      <span role="cell" className="flex justify-end">
        <ServiceActions service={service} onDelete={onDelete} />
      </span>
    </ListRow>
  );
}
