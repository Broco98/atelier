import type { ThreadLink } from "./types";

// 새 채팅이 시작할 곳의 **순수 함수**다. 새 채팅이 어디서 시작하나는 주소 씨앗이 정한다(구현 스펙 「01a — 범위와 새 채팅」 · `-new-thread-search.ts`) —
// 고르는 스위치는 없다. 씨앗이 없으면 작업공간 없는 채팅이고, `?new=work`는 ×로 뺄 수 있는 「새 작업공간」 칩을 세운다. 작업공간의 새 채팅
// 탭(`?work=`가 가는 곳 — restart 02a-8)은 칩 없이 그 작업공간에서 시작한다. 고른 곳은 첫 말과 함께 엔진에 간다(`thread_start`의 `link`): 「새
// 작업공간」은 첫 머리말에 「먼저 작업공간 만들기를 제안하라」가 서고 `thread.json`에 그 표시(`newWork`)가 남으며, `?work=`는 Thread를 처음부터 그
// Work에 잇는다. 첫 말 뒤 입력창에는 Work 칩이 없다(restart 02b-2 · 시안 Thread 보드).

/** 새 채팅이 시작할 곳 — 주소 씨앗이다. 씨앗이 없으면 작업공간 없는 채팅이다. */
export function startLink(seed: ThreadLink | null): ThreadLink {
  return seed ?? { kind: "no-work" };
}

/** 「새 작업공간」 칩의 이름. */
export const NEW_WORK = "새 작업공간";

/** 시작할 곳이 바꾸는 입력창 안내 — 그 Work의 제목을 아직 모르면(목록이 서기 전) slug가 제목 자리에 선다. */
export function startPlaceholder(link: ThreadLink, title: string | null): string {
  switch (link.kind) {
    case "no-work":
      return "무엇이든 요청하세요";
    case "new-work":
      return "만들 기능이나 고칠 문제를 적어 주세요";
    case "work":
      return `${title || link.slug}에서 무엇을 할까요?`;
  }
}
