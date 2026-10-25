import { readStored, writeStored } from "@/lib/stored";
import type { SearchHit } from "@/features/search/types";
import type { ThreadLink } from "./types";

// 입력창 Work 칩(v1 티켓 31 · 03 구현 스펙 §5 · 캔버스 v52 F4-KitComposer · F4-HomeWorkMenu)의 **순수 함수**다. Work 칩은 트레이의 첫 칩이고
// 새 Thread가 어디서 시작하나를 고르는 스위치다 — 「새 Work」 · 「Work 없이 대화」, 그리고 최근 Work. 고르면 칩 글자와 입력창 안내가 따라
// 바뀐다. 고른 것은 첫 말과 함께 엔진에 간다(`thread_start`의 `link`): 「새 Work」는 첫 머리말에 「먼저 Work 만들기를 제안하라」가 서고
// `thread.json`에 그 표시(`newWork`)가 남으며, 최근 Work는 Thread를 처음부터 그 Work에 잇는다. 첫 말을 보낸 뒤의 칩은 잠겨 보이기만 한다(S3).
//
// **처음 고를 곳은 주소 씨앗 › 기억한 스위치 쪽 › 「새 Work」다**(S2). 기억은 사람 한 명의 입력 버릇이라 이 컴퓨터의 웹뷰 저장소에 둔다 —
// 마지막에 고른 스위치 쪽만 적고, 최근 Work를 고른 것은 적지 않는다(다음 새 Thread가 엉뚱한 Work에 붙지 않게). 지워지거나 읽지 못하면
// 기본값 「새 Work」로 돌아갈 뿐이다.

/** 최근 Work 한 줄 — 메뉴의 이름. 줄 끝의 흐린 Space 이름은 Space 칩이 서면 단다(03 티켓 06). */
export interface RecentWork {
  slug: string;
  title: string;
}

/** 메뉴가 세우는 최근 Work의 수 — 다섯이 넘으면 ⌘K로 찾는다. */
const RECENT_LIMIT = 5;

/**
 * 최근 Work — 검색이 준 빈 질의의 Work 줄 차례 그대로다(고정 먼저 → 마지막으로 연 차례, `search.rs`의 `work_hits`). 그 차례를 여기서 다시
 * 세우지 않는다 — 최근의 정의는 코어 한 곳에 있다(`recent.rs`). 보관된 Work는 이을 수 없어 뺀다 — 남는 것이 진행 중인 Work다.
 */
export function recentWorks(hits: readonly SearchHit[]): RecentWork[] {
  return hits
    .flatMap((hit) => (hit.kind === "work" && !hit.archived ? [hit] : []))
    .slice(0, RECENT_LIMIT)
    .map((hit) => ({ slug: hit.slug, title: hit.title }));
}

/** 스위치 쪽을 적는 열쇠 — 값은 `new-work` · `no-work` 둘이다. */
const SWITCH_KEY = "work-chip-switch";

/**
 * 새 Thread가 처음 고를 곳(S2) — 주소 씨앗(`seed`)이 있으면 그것이고, 없으면 기억한 스위치 쪽이다. 적은 적이 없거나 읽지 못하거나 모르는
 * 값이면 「새 Work」다(스토리 14 — 대표 길이 기본이다).
 */
export function startLink(seed: ThreadLink | null): ThreadLink {
  if (seed !== null) return seed;
  return readStored(SWITCH_KEY) === "no-work" ? { kind: "no-work" } : { kind: "new-work" };
}

/** 메뉴에서 고른 것을 기억한다 — 스위치 쪽(「새 Work」 · 「Work 없이 대화」)만 적는다. 최근 Work는 적지 않는다(스토리 19). */
export function rememberSwitch(link: ThreadLink): void {
  if (link.kind !== "work") writeStored(SWITCH_KEY, link.kind);
}

/**
 * 고른 것이 바꾸는 글 둘 — 칩 글자 · 비어 있을 때의 입력창 안내. 빈 Thread의 부제(「Host가 답합니다. …」)는 걷었다(v1 티켓 46 — 칩이 이미
 * 고른 것을 말한다).
 */
export interface WorkHome {
  chip: string;
  placeholder: string;
}

/** 「Work 없이 대화」 스위치의 이름 — 첫 말 전의 칩 · 메뉴와 첫 말 뒤의 잠긴 칩이 같은 말이다(시안 v52). */
const NO_WORK = "Work 없이 대화";

/** 고른 것의 글 — 고른 Work의 제목을 아직 모르면(목록이 서기 전) slug가 제목 자리에 선다. */
export function workHome(link: ThreadLink, title: string | null): WorkHome {
  switch (link.kind) {
    case "no-work":
      return { chip: NO_WORK, placeholder: "무엇이든 요청하세요" };
    case "new-work":
      return { chip: "새 Work", placeholder: "만들 기능이나 고칠 문제를 적어 주세요" };
    case "work": {
      const name = title || link.slug;
      return { chip: name, placeholder: `${name}에서 무엇을 할까요?` };
    }
  }
}

/**
 * 첫 말 뒤의 잠긴 Work 칩(03 §5 · S3) — 메뉴 없이 보이기만 한다. Work에 이은 Thread는 그 Work 이름(누르면 그 Work 화면)이고, Work 없는
 * Thread는 「Work 없이 대화」다. 「새 Work」로 시작해 아직 Work가 서지 않은 Thread는 흐린 「새 Work」다 — 첫 말 뒤에도 Thread 화면에 머물므로
 * (S22) 칩이 「Work를 만드는 중」을 말한다. Work 만들기 카드를 받아들이면 `work`가 서서 그 Work 이름이 된다.
 */
export type LockedWork =
  | { kind: "work"; slug: string; label: string }
  | { kind: "no-work"; label: string }
  | { kind: "new-work"; label: string };

/** 잠긴 칩의 갈래 — `work`는 이은 Work의 slug, `title`은 그 제목(모르면 `null` — slug가 선다), `newWork`는 「새 Work」로 시작했나다. */
export function lockedWork(work: string | null, title: string | null, newWork: boolean): LockedWork {
  if (work !== null) return { kind: "work", slug: work, label: title || work };
  return newWork ? { kind: "new-work", label: "새 Work" } : { kind: "no-work", label: NO_WORK };
}
