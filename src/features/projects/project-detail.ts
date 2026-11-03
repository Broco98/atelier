import { FIRST_SORT, sortPlaces } from "@/components/catalog/place-list";
import { serviceActivity } from "@/features/services/service-activity";
import { serviceMembers, serviceName } from "@/features/services/service-view";
import type { Service } from "@/features/services/types";
import { chatName } from "@/features/thread/chat-name";
import type { ThreadSummary } from "@/features/thread/types";
import type { WorkView } from "@/features/works/types";
import { countsAsActivity, workActivity } from "@/features/works/work-activity";

// **Project 상세의 묶음**(restart 03-2 · 스펙 「03 — 목록과 상세」 · 스토리 114 · 보드 MainProjectDetail · Places `DETAILS`) — 작업공간 · 채팅 ·
// Service. 「상세에 Work 묶음을 두지 않는다」(S21)를 뒤집는다. 저장하지 않고 화면이 이미 쥔 목록(작업공간 · 채팅 · Service)에서 짓는다 — 그 목록들은
// 사건으로 따라오므로 상세도 함께 따라온다. 줄마다 이름 · 옆 글 · 시각이고, 묶음 안은 최근 활동 순이다(목록의 처음 차례와 같다 — `sortPlaces`).
//
//   작업공간 ─ 그 Project를 고치는 작업공간. 옆 글은 브랜치, 시각은 그 작업공간에 이은 채팅의 마지막 줄
//   채팅 ─ 그 Project를 범위로 연 작업공간 밖 채팅. 옆 글은 「작업공간 밖」(보드), 시각은 그 채팅의 마지막 줄. 작업공간의 채팅은 그 작업공간 줄로 간다
//   Service ─ 그 Project를 넣은 Service. 옆 글은 「Project N개」(등록된 것만 — `serviceMembers`, restart 03-3), 시각은 그 Service의 최근 활동(`serviceActivity`)
//
// 시각은 `projectActivity`와 같은 셈이다 — 깨진 채팅 · 읽기만인 채팅(보관한 작업공간의 것)은 세지 않는다.

/** 묶음의 줄 하나 — 시각(`at`)은 글이 아니라 시각 그대로다(그린 때의 지금으로 글을 세운다 — `placeWhen`). */
export interface DetailRow {
  name: string;
  desc: string;
  at: string | null;
}

export interface WorkRow extends DetailRow {
  slug: string;
}

export interface ChatRow extends DetailRow {
  id: string;
}

export interface ServiceRow extends DetailRow {
  slug: string;
}

export interface ProjectSections {
  works: WorkRow[];
  chats: ChatRow[];
  services: ServiceRow[];
}

type WorkPart = Pick<WorkView, "slug" | "title" | "branch" | "projects" | "service">;
type ServicePart = Pick<Service, "slug" | "name" | "projects" | "problems">;

const recent = <T extends DetailRow>(rows: T[]) => sortPlaces(rows, FIRST_SORT, (row) => row.name, (row) => row.at);

/** 그 Project의 상세 묶음 셋 — 빈 묶음도 빈 목록으로 돌려준다(그리지 않는 것은 화면이 정한다). */
export function projectSections(
  slug: string,
  works: readonly WorkPart[],
  threads: readonly ThreadSummary[],
  services: readonly ServicePart[],
): ProjectSections {
  const ofWork = workActivity(threads);
  const listing = services.filter((service) => service.projects.includes(slug));
  const ofService = serviceActivity(
    listing.map((service) => service.slug),
    works,
    threads,
  );
  return {
    works: recent(
      works
        .filter((work) => work.projects.includes(slug))
        .map((work) => ({ slug: work.slug, name: work.title || work.slug, desc: work.branch ?? "", at: ofWork.get(work.slug) ?? null })),
    ),
    chats: recent(
      threads
        .filter((thread) => thread.work === null && thread.project === slug && countsAsActivity(thread))
        .map((thread) => ({ id: thread.id, name: chatName(thread), desc: "작업공간 밖", at: thread.lastAt })),
    ),
    services: recent(
      listing.map((service) => ({
        slug: service.slug,
        name: serviceName(service),
        desc: `Project ${serviceMembers(service).length}개`,
        at: ofService[service.slug] ?? null,
      })),
    ),
  };
}
