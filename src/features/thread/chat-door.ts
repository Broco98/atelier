import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { chatHome, chatSearch, recallSearch } from "@/routes/-work-search";
import type { ThreadSummary } from "./types";

// **채팅으로 가는 문**(restart 02a-4 · 구현 스펙 「02a — 채팅 탭은 새로 짓는다」) — 살아 있는 작업공간의 채팅은 그 작업공간 화면의 채팅
// 탭에 서고, 작업공간 밖 채팅과 보관되거나 지워진 작업공간의 채팅은 `/threads/:id`에 선다. 어느 쪽인지는 `chatHome`(코어의 `gone`)이 정한다.
// 사이드바의 채팅 줄 · 작업공간 줄, ⌘J, `/threads/:id`의 보내기가 이 문 하나를 지난다 — 자리마다 갈래를 다시 적으면 한 자리만
// `/threads/:id`로 가 채팅이 작업공간 밖에서 열린다.

/** 문이 보는 것 — 채팅 id와 그 채팅이 이은 작업공간 · 읽기만인 까닭(목록 요약이든 채팅 화면의 값이든 같은 셋을 든다). */
export type ChatPlace = Pick<ThreadSummary, "id" | "work" | "readOnly">;

/**
 * 그 채팅으로 간다. 작업공간 화면으로 갈 때는 그 작업공간의 기억을 씨앗으로 삼고(`recallSearch` — 보던 문서 · 분할이 남는다) 채팅 탭을
 * 그 채팅으로 세운다(`chatSearch`). 묶음에 그 탭이 없으면 작업공간 화면이 주소를 받아 연다(주소 → 묶음). `replace`는 주소만 고치는
 * 자리(`/threads/:id`의 보내기)가 쓴다.
 */
export function useOpenChat(): (thread: ChatPlace, options?: { replace?: boolean }) => void {
  const navigate = useNavigate();
  return useCallback(
    (thread: ChatPlace, { replace = false }: { replace?: boolean } = {}) => {
      const home = chatHome(thread);
      if (home === null) {
        void navigate({ to: "/threads/$id", params: { id: thread.id }, replace });
        return;
      }
      void navigate({
        to: "/works/$slug",
        params: { slug: home },
        search: chatSearch(recallSearch(home), thread.id),
        replace,
      });
    },
    [navigate],
  );
}
