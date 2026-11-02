import type { ThreadLink } from "./types";

// 입력창 Work 칩의 **순수 함수**다. 새 채팅이 어디서 시작하나는 주소 씨앗이 정한다(구현 스펙 「01a — 범위와 새 채팅」 · `-new-thread-search.ts`) —
// 고르는 스위치는 없다. 씨앗이 없으면 작업공간 없는 채팅이고, `?new=work`는 ×로 뺄 수 있는 「새 작업공간」 칩을, `?work=`는 그 작업공간의 잠긴 칩을
// 세운다. 고른 곳은 첫 말과 함께 엔진에 간다(`thread_start`의 `link`): 「새 작업공간」은 첫 머리말에 「먼저 작업공간 만들기를 제안하라」가 서고
// `thread.json`에 그 표시(`newWork`)가 남으며, `?work=`는 Thread를 처음부터 그 Work에 잇는다. 첫 말을 보낸 뒤의 칩은 잠겨 보이기만 한다(S3).

/** 새 채팅이 시작할 곳 — 주소 씨앗이다. 씨앗이 없으면 작업공간 없는 채팅이다. */
export function startLink(seed: ThreadLink | null): ThreadLink {
  return seed ?? { kind: "no-work" };
}

/** 「새 작업공간」 칩의 이름 — 첫 말 전의 칩과 첫 말 뒤의 잠긴 칩이 같은 말이다. */
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

/**
 * 잠긴 Work 칩(03 §5 · S3) — 메뉴 없이 보이기만 한다. Work에 이은 Thread와 `?work=`로 연 새 채팅은 그 Work 이름(누르면 그 Work 화면)이고, Work 없는
 * Thread는 「작업공간 없이 대화」다. 「새 작업공간」으로 시작해 아직 Work가 서지 않은 Thread는 흐린 「새 작업공간」이다 — 첫 말 뒤에도 Thread 화면에 머물므로
 * (S22) 칩이 「작업공간을 만드는 중」을 말한다. Work 만들기 카드를 받아들이면 `work`가 서서 그 Work 이름이 된다.
 */
export type LockedWork =
  | { kind: "work"; slug: string; label: string }
  | { kind: "no-work"; label: string }
  | { kind: "new-work"; label: string };

/** 잠긴 칩의 갈래 — `work`는 이은 Work의 slug, `title`은 그 제목(모르면 `null` — slug가 선다), `newWork`는 「새 작업공간」으로 시작했나다. */
export function lockedWork(work: string | null, title: string | null, newWork: boolean): LockedWork {
  if (work !== null) return { kind: "work", slug: work, label: title || work };
  return newWork ? { kind: "new-work", label: NEW_WORK } : { kind: "no-work", label: "작업공간 없이 대화" };
}
