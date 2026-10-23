import type { SearchHit } from "@/features/search/types";
import type { ThreadLink, ThreadSummary } from "./types";

// 입력창 Work 칩(v1 티켓 31 · 구현 스펙 §11 「Work 칩」 · 스토리 94–96 · 캔버스 Screen-Home 보드)의 **순수 함수**다. 새 Thread에서 어디서 일할지
// 고르면 — Work 없이 · 새 Work로 시작 · 최근 Work — 칩 글자와 빈 Thread의 부제 · 입력창 안내가 따라 바뀐다. 고른 것은 첫 말과 함께
// 엔진에 간다(`thread_start`의 `link`): 새 Work로 시작은 첫 머리말에 「먼저 Work 만들기를 제안하라」가 서고, 최근 Work는 Thread를
// 처음부터 그 Work에 잇는다. 첫 말을 보낸 뒤의 칩은 이은 Work를 보이기만 한다.

/** 최근 Work 한 줄 — 메뉴의 이름과 그 Work에 이은 Thread 수(「Thread 2개」). */
export interface RecentWork {
  slug: string;
  title: string;
  threads: number;
}

/** 메뉴가 세우는 최근 Work의 수 — 다섯이 넘으면 ⌘K로 찾는다. */
const RECENT_LIMIT = 5;

/**
 * 최근 Work — 검색이 준 빈 질의의 Work 줄 차례 그대로다(고정 먼저 → 마지막으로 연 차례, `search.rs`의 `work_hits`). 그 차례를 여기서 다시
 * 세우지 않는다 — 최근의 정의는 코어 한 곳에 있다(`recent.rs`). 보관된 Work는 이을 수 없어 뺀다.
 */
export function recentWorks(hits: readonly SearchHit[], threads: readonly ThreadSummary[]): RecentWork[] {
  return hits
    .flatMap((hit) => (hit.kind === "work" && !hit.archived ? [hit] : []))
    .slice(0, RECENT_LIMIT)
    .map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      threads: threads.filter((one) => one.work === hit.slug).length,
    }));
}

/** 고른 것이 바꾸는 글 셋 — 칩 글자 · 빈 Thread의 부제 · 비어 있을 때의 입력창 안내(Screen-Home 보드의 세 갈래). */
export interface WorkHome {
  chip: string;
  subtitle: string;
  placeholder: string;
}

/** 고른 것의 글 — 고른 Work의 제목을 아직 모르면(목록이 서기 전) slug가 제목 자리에 선다. */
export function workHome(link: ThreadLink, title: string | null): WorkHome {
  switch (link.kind) {
    case "no-work":
      return {
        chip: "Work 없음",
        subtitle: "Host가 답합니다. Work는 필요할 때 Host가 만들어요.",
        placeholder: "무엇이든 요청하세요",
      };
    case "new-work":
      return {
        chip: "새 Work",
        subtitle: "첫 메시지로 Host가 Work를 만들어요. 고칠 Project는 Host가 물어봐요.",
        placeholder: "만들 기능이나 고칠 문제를 적어 주세요",
      };
    case "work": {
      const name = title || link.slug;
      return { chip: name, subtitle: `‘${name}’에 새 Thread를 열어요.`, placeholder: `${name}에서 무엇을 할까요?` };
    }
  }
}
