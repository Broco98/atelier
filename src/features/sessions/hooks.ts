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
