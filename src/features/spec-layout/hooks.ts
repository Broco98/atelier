import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateArchive } from "@/features/archive/hooks";
import { invalidateWorks } from "@/features/works/hooks";
import type { Mode } from "@/mode";
import { specLayoutApi } from "./api";
import type { LayoutDraft } from "./draft";
import { latestPreview, PREVIEW_DELAY_MS, type DraftPreview } from "./preview";
import type { LayoutPreview, SpecLayoutRead } from "./types";

// ["spec-layout"]으로 시작하는 쿼리(상태, 편집기의 레이아웃 읽기)가 한 번에 무효화된다 — 레이아웃
// 폴더가 바뀌면 둘 다 낡는다(구현 스펙 3절).
const SPEC_LAYOUT_KEY = ["spec-layout"] as const;

/**
 * 레이아웃이 바뀌었다고 알리는 **유일한 문**(구현 스펙 3절). 레이아웃 폴더의 감시(`layouts:changed`)도,
 * 앱이 레이아웃을 되돌리거나(티켓 10) 저장하는 것(티켓 11)도, 감시가 놓친 것을 메우는 설정의 [다시 읽기]도 여기를
 * 탄다.
 *
 * **레이아웃에서 나온 것을 모두 지운다** — 레이아웃 상태·읽기 쿼리, 그리고 spec 트리를 싣고 오는 work
 * 목록과 아카이브 문서 목록이다. 쓰는 레이아웃이 바뀌면 spec 트리도 바뀌기 때문이다. 두 세계를 다
 * 지우는 것은 이벤트가 하나라서다: 어느 모드의 폴더가 바뀌었는지 모른다.
 *
 * work 목록과 아카이브는 **제 문을 지난다**(`invalidateWorks`·`invalidateArchive`). 키를 여기서 직접
 * 지우면 옮기기가 떠 있을 때 미루는 규칙(`invalidateWorks`의 머리말)을 건너뛰어, 옛 순서가 옮기기
 * 응답을 덮을 수 있다.
 *
 * 돌려주는 promise는 셋이 다 끝날 때 풀린다 — 기다릴지 말지는 부르는 쪽이 정한다(그 짝들과 같다).
 */
export function invalidateSpecLayout(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: SPEC_LAYOUT_KEY }),
    invalidateWorks(queryClient),
    invalidateArchive(queryClient),
  ]).then(() => undefined);
}

/**
 * 레이아웃 폴더의 감시를 듣는다 — `layouts:changed`가 오면 위 문을 연다. 에이전트가 레이아웃을
 * 저장하거나 사람이 손으로 고치면, 열려 있는 설정의 「spec 레이아웃」과 spec 패널 탭, 아카이브 문서
 * 트리가 [다시 읽기] 없이 따라온다(spec 레이아웃 결정 22).
 *
 * **셸이 한 번만 부른다**(구현 스펙 3절 — 구독은 앱 전역에 하나). 편집기(티켓 15)도 따로 듣지 않고,
 * 여기서 다시 읽힌 읽기 쿼리로 밖 변경을 판정한다. L3 하네스의 이벤트 쏘기가 그 이벤트의 마지막 구독
 * 하나만 부르는 것도 까닭이다 — 구독이 둘이면 L3가 한쪽만 깨워 다른 쪽을 잴 수 없다. 이 둘은
 * `hooks.test.ts`가 소스로 센다.
 *
 * 배선은 work 목록의 `works:changed` 구독(`useWorks`)과 같다.
 */
export function useFollowLayoutChanges() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen("layouts:changed", () => {
      // 이벤트에는 기다릴 사람이 없다 — works 쪽 리스너와 같다.
      void invalidateSpecLayout(queryClient);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);
}

/**
 * 모드 둘의 레이아웃 상태. **신선도를 시간에 맡기지 않는다**(`staleTime` 없음) — 설정의 「spec
 * 레이아웃」 페이지를 열 때마다 새로 읽고, 레이아웃 폴더가 바뀌거나(`useFollowLayoutChanges`) [다시 읽기]가
 * 위 문을 열면 다시 읽는다. 에이전트가 레이아웃을 고쳤는데 옛 상태가 서 있으면 사람은 부탁이 안 먹었다고
 * 읽는다.
 */
export const specLayoutStatesQuery = () =>
  queryOptions({
    queryKey: [...SPEC_LAYOUT_KEY, "states"],
    queryFn: specLayoutApi.states,
  });

/**
 * 편집기가 여는 모드의 레이아웃(티켓 11). 상태와 같은 머리 키 아래에 산다 — 레이아웃 폴더가 바뀌거나
 * (감시) 앱이 되돌리거나 저장하면 위 문 하나가 함께 지운다. 편집기는 처음 읽은 것으로 초안을 짓고,
 * 그 뒤에 다시 읽힌 답은 초안을 덮지 않고 기준본과 견준다(티켓 15, `judgeOutside`) — 초안이 없을 때만 조용히
 * 따라간다.
 */
export const specLayoutReadQuery = (id: Mode) =>
  queryOptions({
    queryKey: [...SPEC_LAYOUT_KEY, "read", id],
    queryFn: () => specLayoutApi.read(id),
  });

/** 편집기가 저장에 싣는 것 — 모드와, 초안의 레이아웃과 템플릿 본문 전부. */
export interface LayoutWrite extends LayoutDraft {
  id: Mode;
}

/**
 * 편집기의 저장(티켓 11). 템플릿은 늘 전부 넘긴다. 답의 `errors`가 비어 있으면 썼다 — 그때만 **위 문을
 * 연다**(`invalidateSpecLayout`): 상태 행, 레이아웃 읽기, spec 트리를 싣고 오는 work 목록과 아카이브 문서가
 * 새 레이아웃으로 다시 읽힌다. 검증이 거절한 답에는 아무것도 쓰이지 않았으니 지울 것이 없다.
 *
 * `onWritten`은 썼을 때 **문을 열기 전에** 부른다(티켓 15). 편집기는 거기서 기준본을 저장한 것으로 바꾼다 — 제
 * 저장이 부른 다시 읽기가 도착할 때 기준본이 이미 저장본이어야, 그 답이 밖 변경이 아니라 무시(판정 1번)로 걸린다.
 */
export function useWriteSpecLayout(onWritten?: (written: LayoutWrite) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, layout, templates }: LayoutWrite) => specLayoutApi.write(id, layout, templates),
    onSuccess: (answer, written) => {
      if (answer.errors.length > 0) return undefined;
      onWritten?.(written);
      return invalidateSpecLayout(queryClient);
    },
  });
}

/**
 * 모드의 레이아웃을 기본값으로 되돌린다(티켓 10) — 그 모드의 레이아웃 폴더를 지운다. 확인은 부르는 쪽이
 * 먼저 묻는다(`askRevert`).
 *
 * 되돌린 뒤 **위 문 하나를 연다**(`invalidateSpecLayout`) — 행이 「내장본 그대로」로 돌아오고, spec
 * 트리를 싣고 오는 work 목록과 아카이브 문서가 내장본으로 다시 갈린다. 감시 이벤트(`layouts:changed`)도
 * 곧 오지만 기다리지 않는다: 감시가 놓쳐도, 감시가 없는 L4 다리에서도 되돌린 쪽이 스스로 다시 읽는다.
 * 문의 promise를 돌려주므로 `mutateAsync`는 다시 읽기가 끝난 뒤에 풀린다 — 되돌렸다는 알림이 옛 행
 * 위에 서지 않는다.
 */
export function useRevertSpecLayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Mode) => specLayoutApi.revert(id),
    onSuccess: () => invalidateSpecLayout(queryClient),
  });
}

/**
 * 편집기의 미리보기(티켓 14) — 초안이 바뀔 때마다 **짧은 지연 뒤에** 엔진에 묻는다(`render_spec_layout`). 처음 연
 * 초안도 묻는다: 읽은 레이아웃에 이미 오류(누락 템플릿)가 있으면 그 자리에 선다. 팝업을 닫은 동안에도 묻는다 —
 * 그 답의 오류가 항목 아래에 서고 저장을 잠근다(스토리 30·31).
 *
 * **답은 초안과 디스크에 달렸다.** 초안에 본문이 없는 템플릿은 엔진이 레이아웃 폴더에 그 파일이 있는지를 본다
 * (엔진의 `backed`) — 밖에서 그 파일이 사라지거나 되살아나면 같은 초안의 답이 바뀐다. 그래서 초안이 바뀔 때만이 아니라
 * 레이아웃 폴더를 다시 읽은 것이 바뀔 때도(`disk` — 편집기의 마지막 읽기, 구조 공유라 내용이 바뀔 때만 새 객체다)
 * 다시 묻는다. 고치지 않은 초안도, 밖 변경 배너가 선 동안에도 묻는다 — [내 초안 유지]를 누를 때는 답이 이미 새것이다.
 * 앞 답을 지우지는 않는다: 새 답이 올 때까지 그 오류가 서 있다.
 *
 * 쿼리가 아니다 — 답은 초안 하나에 대한 것이라 캐시로 나눠 쓸 것이 없다. 지연 동안 초안이 또 바뀌면 앞 물음은
 * 나가지 않는다.
 *
 * **요청마다 순번을 둔다** — 늦게 온 옛 답은 새 초안의 답을 덮지 못한다(`latestPreview`). 명령 자체가 거절되면
 * (IPC) 그 까닭을 문서 전체의 오류로 받는다: 저장이 잠기고 까닭이 선다.
 *
 * `reserve(draft)`는 엔진이 **다른 길로** 줄 판정의 순번을 지금 잡고, 그 답을 받을 손을 돌려준다 — 저장의 검증
 * 거절이 그것이다. 미리보기와 저장 사이에 디스크가 바뀌면(템플릿 파일이 사라졌다) 저장이 거절하고, 그 오류가 그
 * 초안의 답이 된다. 순번을 **저장을 누른 때** 잡으므로, 저장하는 동안 초안을 또 고쳐 나간 물음의 답은 거절보다
 * 새것으로 남는다. 거절은 초안이나 레이아웃 폴더가 바뀌어 다시 물을 때까지 선다.
 *
 * 초안이 없으면(`null` — 밖에서 깨져 편집기가 「읽지 못함」 화면이다, 티켓 15) 묻지 않는다.
 */
export function useDraftPreview(id: Mode, draft: LayoutDraft | null, disk: SpecLayoutRead) {
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const seq = useRef(0);

  const reserve = useCallback((draft: LayoutDraft) => {
    const mine = ++seq.current;
    return (answer: LayoutPreview) => setPreview((now) => latestPreview(now, { seq: mine, draft, answer }));
  }, []);

  // `disk`는 본문에서 읽지 않는다 — 폴더를 다시 읽은 것이 바뀌면 같은 초안을 다시 묻게 하는 방아쇠다.
  useEffect(() => {
    if (draft === null) return;
    const timer = window.setTimeout(() => {
      const arrive = reserve(draft);
      specLayoutApi.render(id, draft.layout, draft.templates).then(arrive, (e: unknown) =>
        arrive({ text: null, lines: [], errors: [{ path: null, message: String(e) }], warnings: [] }),
      );
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [id, draft, disk, reserve]);

  return { preview, reserve };
}
