import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionsApi } from "./api";
import type { Envelope } from "./types";

// sessions/ 는 앱이 유일한 필자라 파일 감시자가 없다. 목록은 변경을 만든 쪽이 무효화한다.
const SESSIONS_KEY = ["sessions"] as const;
// 재생은 목록과 **다른 뿌리**에 둔다. 목록을 무효화해도 지난 대화를 다시 읽지 않도록.
const REPLAY_KEY = ["session-replay"] as const;
const PROMPT_KEY = ["session-prompt"] as const;

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: sessionsApi.list });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectSlug: string) => sessionsApi.create(projectSlug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}

/**
 * 지난 대화. **과거는 언제나 이쪽이 그린다.**
 *
 * 화면에 붙어 있는 동안에는 다시 읽지 않는다 — 다시 읽으면 이미 라이브로 이어붙인 줄들과
 * 겹친다. 대신 화면을 떠나는 순간 캐시를 버려서, 돌아왔을 때는 그동안 쌓인 것까지 포함한
 * 파일 전체를 새로 읽는다.
 *
 * `listening`이 참이 되기 전에는 읽지 않는다. 읽기가 먼저 끝나면 그 뒤 귀를 여는 사이에
 * 온 조각이 재생에도 라이브에도 없어 통째로 빠진다.
 */
export function useSessionReplay(sessionId: string | null, listening: boolean) {
  return useQuery({
    queryKey: [...REPLAY_KEY, sessionId],
    queryFn: () => sessionsApi.readUpdates(sessionId!),
    enabled: sessionId !== null && listening,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** 라이브로 받은 한 줄과 **기록에서 그 줄이 앉은 자리**. */
export interface LiveLine {
  index: number;
  line: Envelope;
}

/**
 * 쌓이는 사건이라 쿼리 캐시가 아니라 화면의 지역 상태로 둔다.
 *
 * 귀를 여는 것도 비동기라, 다 열렸는지를 함께 돌려준다 — 재생은 그다음에 읽어야 한다.
 */
export function useLiveUpdates(sessionId: string | null) {
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    setLines([]);
    setListening(false);
    if (sessionId === null) return;
    // 떼는 것은 비동기라 먼저 귀를 닫는다. 그러지 않으면 세션을 바꾸는 찰나에 온 조각이
    // 옛 청취자와 새 청취자에게 두 번 들어가 대화에 두 번 그려진다.
    let attached = true;
    const unlisten = listen<{ sessionId: string; index: number; line: Envelope }>(
      "session:update",
      (event) => {
        if (!attached || event.payload.sessionId !== sessionId) return;
        const { index, line } = event.payload;
        setLines((seen) => [...seen, { index, line }]);
      },
    ).then((fn) => {
      if (attached) setListening(true);
      return fn;
    });
    return () => {
      attached = false;
      unlisten.then((fn) => fn());
    };
  }, [sessionId]);

  return { lines, listening };
}

/**
 * 턴 하나를 보낸다. **턴이 도는지는 화면이 아니라 쿼리 클라이언트가 안다** — 세션을 옮겼다
 * 돌아와 대화 화면이 새로 그려져도 잠금이 그대로 남는다.
 */
export function usePromptSession(sessionId: string) {
  const queryClient = useQueryClient();
  const key = [...PROMPT_KEY, sessionId];
  const prompt = useMutation({
    mutationKey: key,
    mutationFn: (text: string) => sessionsApi.prompt(sessionId, text),
    // 턴이 끝날 때 **한 번만** — 첫 지시가 세션의 이름이 된다. 조각마다 무효화하면
    // 목록이 조각 수만큼 흔들린다.
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  return { send: prompt.mutateAsync, running: useIsMutating({ mutationKey: key }) > 0 };
}

/**
 * 죽은 세션을 다시 띄운다. **지난 대화는 건드리지 않는다** — 화면은 이미 재생으로 채워져
 * 있고, 여기서 되찾는 것은 말할 상대뿐이다.
 *
 * 상대가 지난 세션 불러오기를 지원하든 아니든 화면은 같다. 그 분기는 아래층에 갇혀 있고,
 * 여기로 올라오는 것은 다시 뜬 세션 한 줄뿐이다.
 */
export function useResumeSession(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.resume(sessionId),
    // 살아있음이 바뀌었다. 목록도 대화 화면도 그 사실을 이 무효화로 받는다.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}

/**
 * 돌고 있는 턴을 멈춘다. **세션을 끝내는 것이 아니다** — 턴만 접히고 같은 세션에 이어서
 * 다시 지시할 수 있다.
 *
 * 턴이 실제로 끝나는 것은 `usePromptSession`이 붙잡고 있는 쪽이 돌아오는 것으로 보이므로,
 * 여기서 화면을 미리 고치지 않는다.
 */
export function useCancelSession(sessionId: string) {
  return useMutation({ mutationFn: () => sessionsApi.cancel(sessionId) });
}

/**
 * 권한 카드의 답. 답이 기록에 남으면 그 줄이 라이브로 돌아와 카드가 스스로 답한 모습으로
 * 다시 그려지므로, 여기서 화면을 미리 고치지 않는다.
 */
export function useAnswerPermission(sessionId: string) {
  return useMutation({
    mutationFn: ({ requestId, optionId }: { requestId: string; optionId: string }) =>
      sessionsApi.answerPermission(sessionId, requestId, optionId),
  });
}

/**
 * 목록이 보여 주는 **런타임의 사실**을 바꾸는 봉투들 — 답을 기다리는 요청이 생기거나
 * 사라졌다, 그리고 에이전트가 끝났다.
 */
const RUNTIME_KINDS = ["permission_request", "permission_response", "agent_exited"];

/**
 * 런타임의 사실이 바뀌면 목록을 다시 읽는다.
 *
 * 살아있음과 답을 기다림은 신원 파일에 없으므로 파일을 다시 읽어도 알 수 없다. 봉투 한 줄이
 * 그 소식이 오는 유일한 길이고, 그래서 **따로 난 이벤트 통로가 없다**(티켓 06과 같은 이유).
 *
 * 대화 화면이 아니라 **페이지**가 이 귀를 연다 — 지금 보고 있지 않은 세션의 변화도
 * 목록에서 보여야 하기 때문이다.
 */
export function useWatchSessionRuntime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let attached = true;
    const unlisten = listen<{ line: Envelope }>("session:update", (event) => {
      if (!attached || !RUNTIME_KINDS.includes(event.payload.line.kind)) return;
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    });
    return () => {
      attached = false;
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);
}
