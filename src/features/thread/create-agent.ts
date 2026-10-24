import { useCallback } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { fillDraft, NEW_THREAD } from "./thread-store";

/** 「새 Agent 만들기」가 새 Thread의 입력창에 채우는 말(v1 구현 스펙 §16 · 스토리 67). 보내는 것은 사람이다 — 고쳐 보내도 된다. */
export const CREATE_AGENT_ASK = "Agent를 하나 만들고 싶어";

/**
 * 「새 Agent 만들기」(@ 메뉴 끝 줄 · Library 화면) — **새 Thread를 열고** 입력창에 Agent 만들기를 맡기는 말을 채운다(§16). Host가 받아
 * 대화로 Agent 파일을 짓고 Thread 도구 「Agent 저장」으로 Library에 둔다(스토리 66). 이미 새 Thread면 그 입력창을 채운다. 새 Thread의
 * 쓰던 글은 이 말로 갈린다. 채운 입력칸이 포커스를 받는다 — Enter 한 번이면 보낸다.
 */
export function useCreateAgent(): () => void {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(() => {
    fillDraft(NEW_THREAD, CREATE_AGENT_ASK);
    if (router.state.location.pathname !== "/") void navigate({ to: "/" });
  }, [router, navigate]);
}
