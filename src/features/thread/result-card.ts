import type { ResultAction, ResultEntry } from "./fold";

// 결과 카드의 값(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「대화로 한 설정 — 결과 카드」 · F4-ThreadNoWork) — Agent가 대화로 한 설정
// (Project 추가 · Project 고침 · Space 만듦 · Space 고침)이 흐름에 남기는 카드 하나다. 왼쪽 아이콘(Project · Space), 첫 줄과 흐린 둘째 줄,
// 오른쪽 「열기」(Space 고침은 「관계 보기」)이고, 단추는 그 대상의 상세 화면으로 간다 — 사람이 거기서 다시 고친다. 두 줄의 글은 엔진이 지어
// `setting` 줄에 실었다. 이 함수는 아이콘 · 단추 · 갈 곳 · 꺼짐만 고른다. 그리는 것은 `ResultCard`다.
//
// - 승인 카드가 아니다 — 사람이 대화로 부탁한 설정이라 묻지 않고 했다(S13). 되돌리기 단추는 없다.
// - **대상이 그사이 사라졌으면 단추가 꺼진다** — 지금 목록에 그 slug가 없으면. 목록을 아직 읽지 못했으면 켜 둔다(가 보면 그 화면이 말한다).

/** 대상의 갈래 — 아이콘과 갈 곳이 이것으로 갈린다. */
export type ResultTarget = "project" | "space";

/** 단추가 가는 곳 — 그 Project · Space의 상세 화면. */
export type ResultTo =
  | { to: "/projects/$slug"; params: { slug: string } }
  | { to: "/spaces/$slug"; params: { slug: string } };

/** 카드의 값 — 아이콘 · 두 줄 · 단추 이름 · 갈 곳 · 대상이 사라졌나. */
export interface ResultCardView {
  icon: ResultTarget;
  title: string;
  detail: string;
  action: "열기" | "관계 보기";
  to: ResultTo;
  gone: boolean;
}

/** 그 갈래의 대상이 Project인가 Space인가. */
export function resultTarget(card: Pick<ResultEntry, "action">): ResultTarget {
  const project: readonly ResultAction[] = ["project-added", "project-edited"];
  return project.includes(card.action) ? "project" : "space";
}

/** 카드의 값. `listed`는 지금 그 갈래 목록의 slug들이다 — 아직 읽지 못했으면 null. */
export function resultCardView(card: ResultEntry, listed: readonly string[] | null): ResultCardView {
  const icon = resultTarget(card);
  const params = { slug: card.slug };
  return {
    icon,
    title: card.title,
    detail: card.detail,
    action: card.action === "space-edited" ? "관계 보기" : "열기",
    to: icon === "project" ? { to: "/projects/$slug", params } : { to: "/spaces/$slug", params },
    gone: listed !== null && !listed.includes(card.slug),
  };
}
