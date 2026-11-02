import { FIRST_SORT, placeDay, sortPlaces } from "@/components/catalog/place-list";
import { projectActivity } from "@/features/projects/project-activity";
import type { ProjectView } from "@/features/projects/types";
import type { ThreadSummary } from "@/features/thread/types";
import type { WorkView } from "@/features/works/types";
import { workActivity } from "@/features/works/work-activity";
import { serviceActivity } from "./service-activity";
import { serviceMembers } from "./service-view";
import type { ServiceDetail, ServiceProblem, ServiceProblemKind } from "./types";

// **Service 상세의 묶음**(restart 03-3 · 스펙 「03 — 목록과 상세」 · 스토리 115 · 116 · 보드 MainServiceDetail · Places `DETAILS.payments` ·
// `DETAILS.admin`) — Projects · 작업공간 · 함께 쓰는 Service. 저장하지 않고 화면이 이미 쥔 목록(등록된 Project · 작업공간 · 채팅)과 상세 읽기
// (`get_service` — 함께 쓰는 Service)에서 짓는다. 줄마다 이름 · 옆 글 · 시각이고, 묶음 안은 최근 활동 순이다(Project 상세와 같다 — `sortPlaces`).
//
//   Projects ─ 넣은 Project. 옆 글은 경로(폴더를 찾을 수 없으면 그 말), 시각은 그 Project의 최근 활동(`projectActivity`)
//   작업공간 ─ 그 Service를 쓰는 작업공간(`WorkView.service`). 옆 글은 브랜치, 시각은 그 작업공간에 이은 채팅의 마지막 줄(`workActivity`)
//   함께 쓰는 Service ─ 같은 Project를 넣은 다른 Service(core `shared_services` — 한 Project는 여러 Service에 든다, 스토리 116). 옆 글은
//                       「겹치는 Project · front」, 시각은 그 Service의 최근 활동(`serviceActivity`)
//
// 한때(03) 같은 것을 관계 그래프(`ServiceGraph`)가 그렸다 — 이 묶음들이 그 자리를 갈음한다(구현 지도 「관계 그래프 — 삭제」).

/** 묶음의 줄 하나 — 시각(`at`)은 글이 아니라 시각 그대로다(그린 때의 지금으로 글을 세운다 — `placeWhen`). */
export interface ServiceProjectRow {
  slug: string;
  name: string;
  desc: string;
  at: string | null;
  missing: boolean;
}

export interface ServiceWorkRow {
  slug: string;
  name: string;
  desc: string;
  at: string | null;
}

export interface SharedServiceRow {
  slug: string;
  name: string;
  desc: string;
  at: string | null;
}

export interface ServiceSections {
  projects: ServiceProjectRow[];
  works: ServiceWorkRow[];
  shared: SharedServiceRow[];
}

type ProjectPart = Pick<ProjectView, "slug" | "name" | "path" | "missing">;
type WorkPart = Pick<WorkView, "slug" | "title" | "branch" | "projects" | "service">;

/**
 * 상세 위 카드 넷(보드 `DETAILS.payments` · `fallback('services')`) — Project 수(등록된 것만 — `serviceMembers`) · 그 Service를 쓰는 작업공간 수(작업공간
 * 목록은 보관하지 않은 것뿐이라 모두 「진행 중」이다) · 함께 쓰는 Service 수 · 만든 날(`placeDay`). 없으면 「없음」이다.
 */
export function serviceFacts(
  service: Pick<ServiceDetail, "slug" | "projects" | "problems" | "shared" | "createdAt">,
  works: readonly Pick<WorkView, "service">[],
): { label: string; value: string }[] {
  const count = (n: number, tail = "") => (n === 0 ? "없음" : `${n}개${tail}`);
  return [
    { label: "Project", value: count(serviceMembers(service).length) },
    { label: "작업공간", value: count(works.filter((work) => work.service === service.slug).length, " 진행 중") },
    { label: "함께 쓰는 Service", value: count(service.shared.length) },
    { label: "만든 날", value: placeDay(service.createdAt) },
  ];
}

/** 경고 머리 — 그 파일에 무엇이 있는지(보드 「등록되지 않은 Project가 있어요」). 줄마다 붙는 core의 말(「등록되지 않은 Project예요」)과 달리 파일 전체를 말한다. */
const HEADLINE: Record<ServiceProblemKind, string> = {
  unknownProject: "등록되지 않은 Project가 있어요",
  duplicateProject: "같은 Project를 두 번 적었어요",
  noName: "이름(name)이 비어 있어요",
  unclosedFrontmatter: "frontmatter가 닫히지 않았어요",
  badYaml: "frontmatter를 YAML로 읽을 수 없어요",
  unreadable: "Service 파일을 글로 읽을 수 없어요",
};

/**
 * 문제가 있는 Service의 상세 경고(스토리 118 · 보드 `DETAILS.admin` · PlaceSheet 「문제가 있는 Service — 파일의 몇째 줄인지까지 말한다」) — 첫 문제의
 * 갈래 · 파일의 줄 · 그 Project를 한 줄로, 더 있으면 그 수를 덧붙인다. 끝의 「파일로 고치기」가 고치기 화면을 연다 — 거기서 문제마다 그 줄 끝에 core의
 * 말이 선다. 글로 읽을 수 없는 파일은 줄이 없다. 문제가 없으면 `null`이다.
 */
export function problemNotice(problems: readonly ServiceProblem[]): string | null {
  const [first, ...rest] = problems;
  if (!first) return null;
  const at = first.kind === "unreadable" ? [] : [`Service 파일 ${first.line}번째 줄`, ...(first.project ? [first.project] : [])];
  const more = rest.length > 0 ? [`다른 문제 ${rest.length}개`] : [];
  const tail = [...at, ...more].join(" · ");
  return tail === "" ? HEADLINE[first.kind] : `${HEADLINE[first.kind]}. ${tail}`;
}

const recent = <T extends { name: string; at: string | null }>(rows: T[]) => sortPlaces(rows, FIRST_SORT, (row) => row.name, (row) => row.at);

/** 그 Service의 상세 묶음 — 빈 묶음도 빈 목록으로 돌려준다(그리지 않는 것은 화면이 정한다). */
export function serviceSections(
  service: Pick<ServiceDetail, "slug" | "projects" | "problems" | "shared">,
  registered: readonly ProjectPart[],
  works: readonly WorkPart[],
  threads: readonly ThreadSummary[],
): ServiceSections {
  const members = serviceMembers(service);
  const ofProject = projectActivity(members, works, threads);
  const ofWork = workActivity(threads);
  const ofShared = serviceActivity(
    service.shared.map((other) => other.slug),
    works,
    threads,
  );
  const nameOf = (slug: string) => registered.find((one) => one.slug === slug)?.name ?? slug;
  return {
    shared: recent(
      service.shared.map((other) => ({
        slug: other.slug,
        name: other.name,
        desc: ["겹치는 Project", ...other.overlap.map(nameOf)].join(" · "),
        at: ofShared[other.slug] ?? null,
      })),
    ),
    works: recent(
      works
        .filter((work) => work.service === service.slug)
        .map((work) => ({ slug: work.slug, name: work.title || work.slug, desc: work.branch ?? "", at: ofWork.get(work.slug) ?? null })),
    ),
    projects: recent(
      members.map((slug) => {
        const project = registered.find((one) => one.slug === slug);
        const missing = project?.missing ?? false;
        return { slug, name: project?.name ?? slug, desc: missing ? "폴더를 찾을 수 없어요" : (project?.path ?? ""), at: ofProject[slug] ?? null, missing };
      }),
    ),
  };
}
