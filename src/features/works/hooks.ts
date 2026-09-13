import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import {
  hashKey,
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { invalidateArchive } from "@/features/archive/hooks";
import { showProblem } from "@/components/ui/confirm-store";
import { worksApi } from "./api";
import { movedWorks, type RowGap } from "./row-drop";
import type { Mode } from "@/mode";
import type { WorkStatus, WorkView } from "./types";

// ["works"]로 시작하는 모든 쿼리(두 세계의 목록·spec 파일)가 works:changed 한 번에 무효화된다.
// **모드는 이 접두사 바로 뒤에 실린다** — 그래야 여기서 한 번 지우는 것이 두 세계를 다 덮는다.
const WORKS_KEY = ["works"] as const;

/**
 * work 목록이 바뀌었다고 알리는 **유일한 문.** 이벤트를 듣는 쪽도 mutation도 여기를 탄다.
 *
 * **두 세계를 함께 지운다.** 백엔드는 `works:changed`를 모드별로 나누지 않으므로(#181 —
 * 나누는 비용보다 저쪽 목록을 한 번 더 읽는 비용이 싸다) 무효화도 접두사여야 한다. 키를
 * `[...WORKS_KEY, mode]`로 좁히면 지금 보는 세계만 갱신되고 **저쪽 세계는 옛 목록을 든 채**
 * 남는다 — 세그먼트로 건너간 순간에야 드러나고, 그때는 「가끔 목록이 낡았다」로만 보인다.
 * 이 성질은 `hooks.test.ts`가 두 세계를 함께 캐시에 심어 붙든다.
 *
 * **돌려주는 promise가 계약의 절반이다.** react-query는 `onSuccess`의 반환을 `await`하므로
 * (query-core `mutation.js`) 이것을 흘려보내야 `isPending`이 목록 재조회가 끝날 때까지 선다.
 * 삼키면(`void`·블록 몸통) work을 지운 순간 진행 표시가 걷히고 ⋯ 버튼의 잠김도 풀리는데
 * 목록은 아직 날아오는 중이라, **방금 지운 work이 브레드크럼과 본문에 그대로 서 있는 창**이
 * 생긴다. 화면으로는 「지웠는데 남아 있다」로만 보인다.
 *
 * **옮기기가 떠 있으면 끝난 뒤로 미뤄 한 번** 돈다(스펙 S9). 곧바로 돌리면 쓰기 **전** 파일을 읽은
 * 느린 재조회(워크트리마다 상태를 묻는다)가 옮기기 응답 **뒤에** 도착해 옛 순서로 덮는다. 순서만
 * 바뀐 쓰기는 감시자가 안 쏘므로(점 파일) 그 옛 순서가 `staleTime` 동안 남는다. 대기가 이 문
 * **안에** 있는 것은 이벤트만 그 경쟁을 여는 것이 아니어서다 — 옮기는 사이 도착한 고정 토글·제목
 * 바꾸기의 응답도 같은 재조회를 띄운다. 미룬 것도 버리지 않는 것은 그 사이 온 무효화가 순서 말고
 * 다른 것(spec 쓰기 · 제목)을 알렸을 수 있어서다 — 몇 번 왔든 다시 읽기 한 번이면 다 덮는다.
 *
 * 미룬 동안 돌려주는 promise는 곧바로 풀린다 — 그 mutation의 진행 표시는 옮기기가 끝나기를 안
 * 기다린다. 옮기기는 파일 한 장 쓰기라 그 창이 한 박자이고, 그것을 기다리게 하면 이 문이 옮기기의
 * 수명을 알아야 한다.
 */
export function invalidateWorks(queryClient: QueryClient) {
  const state = movesOf(queryClient);
  if (state.inFlight > 0) {
    state.deferred = true;
    return Promise.resolve();
  }
  return queryClient.invalidateQueries({ queryKey: WORKS_KEY });
}

/**
 * 캐시마다 **옮기기가 몇 개 떠 있는가**와 그동안 미룬 무효화가 있는가, 그리고 떠 있는 동안 옮기기가
 * **겹친 적이 있는가**(`moveWorkOptions`의 4). 모듈 변수가 아니라 캐시에 매는 것은 L2가 캐시를 검사마다
 * 새로 세우기 때문이다 — 전역이면 앞 검사의 미룸이 뒤로 샌다.
 */
const moves = new WeakMap<QueryClient, { inFlight: number; deferred: boolean; overlapped: boolean }>();
function movesOf(queryClient: QueryClient) {
  let state = moves.get(queryClient);
  if (!state) moves.set(queryClient, (state = { inFlight: 0, deferred: false, overlapped: false }));
  return state;
}

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의.
// 무선택 주소를 어느 작업으로 정규화할지 정하려면 beforeLoad가 목록을 알아야 한다.
//
// staleTime이 없으면 beforeLoad가 막 받아온 목록이 즉시 stale이라 이어서 마운트되는
// useWorks가 같은 IPC를 한 번 더 쏘고, 탭을 옮길 때마다 beforeLoad가 재요청을 기다린다.
// 이 목록의 신선도는 시간이 아니라 works:changed 무효화가 책임지므로(아래 useWorks),
// 여기 값은 그 사이를 메우는 안전망일 뿐이다.
//
// **모드가 인자다.** 캐시가 세계별로 갈려야 `/maison/rooms` 정규화가 Atelier 목록을 읽지
// 않는다 — 한 키에 둘을 담으면 세계를 건널 때마다 앞 세계의 목록이 한 프레임 서고, 그
// 프레임에서 정규화가 돌면 없는 항목으로 간다.
export const worksQuery = (mode: Mode) =>
  queryOptions({
    queryKey: [...WORKS_KEY, mode],
    queryFn: () => worksApi.list(mode),
    staleTime: 30_000,
  });

// 듣는 것은 **모드와 무관하다** — 이벤트가 하나뿐이라 어느 세계의 화면이 듣든 지우는 것은
// 같다. 화면이 둘 다 떠 있을 일이 없으므로 리스너도 하나다.
export function useWorks(mode: Mode) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = listen("works:changed", () => {
      // 이벤트에는 기다릴 사람이 없다 — 여기서만 반환을 버린다.
      void invalidateWorks(queryClient);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(worksQuery(mode));
}

/**
 * spec 문서 한 장. **키를 짓는 자리를 훅 밖에 둔다** — 훅 안에 두면 이 저장소에는 그 키를
 * 값으로 재는 길이 없어(L2에 DOM이 없다) 키에서 `mode`가 빠져도 아무 검사가 안 빨개진다.
 * 그 사고는 두 세계에 같은 이름이 설 수 있어서(결정 10) 「Room의 spec 자리에 같은 이름
 * work의 문서가 뜬다」로 나온다 — `SpecViewer`의 `mode` prop 주석이 든 바로 그 사고다.
 *
 * 모드가 접두사 바로 뒤인 것은 목록과 같은 이유다 — 이 키도 `WORKS_KEY` 무효화에 걸린다.
 */
export const specFileQuery = (mode: Mode, slug: string, path: string | null) => {
  const queryKey = [...WORKS_KEY, mode, "spec", slug, path];
  return queryOptions({
    queryKey,
    queryFn: () => worksApi.readSpec(mode, slug, path!),
    enabled: path !== null,
    // 라이브 리로드(같은 파일 재요청)에서만 이전 내용을 유지해 깜빡임을 막는다.
    // 다른 파일로 전환할 때도 유지하면 새 파일 이름 아래 이전 파일 내용이 보인다.
    placeholderData: (prev, prevQuery) =>
      prevQuery && hashKey(prevQuery.queryKey) === hashKey(queryKey) ? prev : undefined,
  });
};

export function useSpecFile(mode: Mode, slug: string, path: string | null) {
  return useQuery(specFileQuery(mode, slug, path));
}

export function useSetWorkTitle(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, title }: { slug: string; title: string }) =>
      worksApi.setTitle(mode, slug, title),
    onSuccess: () => invalidateWorks(queryClient),
  });
}

export function useSetWorkStatus(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: WorkStatus }) =>
      worksApi.setStatus(mode, slug, status),
    onSuccess: () => invalidateWorks(queryClient),
  });
}

// 고정을 켜고 끈다. 목록 순서까지 바뀌는데(결정 100) 순서는 코어가 정하므로, 여기서는
// 상태 변경과 똑같이 목록을 무효화하기만 한다.
export function useSetWorkPinned(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, pinned }: { slug: string; pinned: boolean }) =>
      worksApi.setPinned(mode, slug, pinned),
    onSuccess: () => invalidateWorks(queryClient),
  });
}

/** 끌어 놓은 행 하나 — 틈(`row-drop`)이 정한 `(pinned, before)`에 끈 slug를 더한 것. */
export interface MoveWorkArgs extends RowGap {
  slug: string;
}

/**
 * 작업 행을 끌어 놓았다(스펙 §5). **훅 밖에 두는 것은 경쟁을 렌더 없이 재기 위해서다** —
 * `hooks.test.ts`가 실물 `QueryClient`에 이 옵션을 그대로 물려 답의 순서를 뒤집는다.
 *
 * 1. 그 세계 목록 질의를 **취소**한다 — 이미 날아오던 재조회가 낙관적 목록을 덮지 않게.
 * 2. 틈의 결과를 **낙관적으로** 쓴다. 놓는 순간 행이 그 자리에 서야 끌기가 끝난 것으로 읽힌다.
 * 3. 응답(새 목록 전체)으로 **갈아 끼운다.** 순서 파일은 감시자가 안 쏘므로 다시 읽기를 기다리면
 *    화면이 안 바뀐다.
 * 4. **옮기기가 겹쳤으면 어느 응답도 안 쓴다.** 응답은 그 호출이 순서 파일을 읽은 순간의 목록이라, 첫
 *    응답이 오기 전에 놓은 둘째 옮기기가 빠져 있을 수 있고 답이 오는 순서도 정해져 있지 않다(명령이
 *    비동기다). 그대로 쓰면 둘째 행이 제자리로 튀었다 돌아오거나, 거꾸로 온 낡은 답이 마지막에 서서
 *    `staleTime` 동안 남는다. 그래서 낙관적 목록을 둔 채 마지막 옮기기가 끝난 뒤 한 번 다시 읽는다.
 *    실패의 되돌리기도 같다 — 제 `previous`로 되돌리면 뒤에 놓은 옮기기의 낙관적 목록까지 지운다.
 * 5. 실패하면 원래 목록으로 되돌리고 앱의 오류 창으로 알린다. **그리고 끝난 뒤 다시 읽는다** — 코어는
 *    `work.json` 쓰기가 실패해도 이미 쓴 순서 파일을 안 되돌리므로(스펙 §2) 되돌린 목록이 디스크와 다를
 *    수 있고, 그 점 파일은 감시자가 안 쏜다.
 *
 * **성공한 옮기기 하나는 `onSettled`에서 무효화하지 않는다.** 응답이 곧 새 목록이라 다시 물을 것이
 * 없다 — 한 번 더 읽으면 IPC만 늘고, 그 사이 다른 쓰기가 끼면 응답보다 낡은 것이 설 자리가 하나 더
 * 생긴다. 미룬 무효화(겹침 · 실패 · 그 사이 온 이벤트)가 있을 때만 돈다.
 */
export function moveWorkOptions(queryClient: QueryClient, mode: Mode) {
  // 목록 **하나만** 겨눈다(`exact`). 접두사로 취소하면 같은 세계의 spec 본문 질의까지 끊긴다.
  const { queryKey } = worksQuery(mode);
  return mutationOptions({
    mutationFn: ({ slug, pinned, before }: MoveWorkArgs) => worksApi.move(mode, slug, pinned, before),
    onMutate: async (args) => {
      // 세기는 **기다리기 전에** 한다 — 취소를 기다리는 사이 온 이벤트도 미뤄야 한다.
      const state = movesOf(queryClient);
      state.inFlight += 1;
      if (state.inFlight > 1) state.overlapped = true;
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<WorkView[]>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, movedWorks(previous, args.slug, args));
      return { previous };
    },
    onSuccess: (works) => {
      const state = movesOf(queryClient);
      if (state.overlapped) state.deferred = true;
      else queryClient.setQueryData(queryKey, works);
    },
    onError: (error, _args, context) => {
      const state = movesOf(queryClient);
      if (!state.overlapped && context?.previous) queryClient.setQueryData(queryKey, context.previous);
      state.deferred = true;
      void showProblem(`순서를 바꾸지 못했습니다: ${error}`);
    },
    onSettled: () => {
      const state = movesOf(queryClient);
      state.inFlight -= 1;
      if (state.inFlight > 0) return;
      state.overlapped = false;
      if (!state.deferred) return;
      state.deferred = false;
      // 기다리지 않는다 — 돌려주면 `isPending`이 그 재조회까지 서서 다음 끌기가 그만큼 미뤄 보인다.
      void invalidateWorks(queryClient);
    },
  });
}

export function useMoveWork(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation(moveWorkOptions(queryClient, mode));
}

// 아카이브와 삭제 모두 작업 목록에서 사라지게 만든다. 다만 아카이브는 **반대편에 하나를
// 더한다** — 파일 감시가 뒤늦게 알려주기를 기다리지 않고 여기서 함께 무효화한다.
// 그러지 않으면 방금 치운 작업이 Archive 화면에 바로 나타나지 않는다.
export function useArchiveWork(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => worksApi.archive(mode, slug),
    // **여기만 기다리지 않는다.** 문 둘을 함께 여는 자리라 예전에도 블록 몸통이었고, 그래서
    // 아카이빙의 `isPending`은 원래부터 커맨드가 돌아오면 풀렸다. 기다리게 바꾸는 것이 더
    // 나을 수 있지만 그것은 이 티켓이 건드린 자리가 아니다 — 여기서 바꾸면 모드를 나누는
    // 변경에 Atelier 동작 변화가 조용히 섞인다.
    onSuccess: () => {
      void invalidateWorks(queryClient);
      void invalidateArchive(queryClient);
    },
  });
}

export function useRemoveWork(mode: Mode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => worksApi.remove(mode, slug),
    onSuccess: () => invalidateWorks(queryClient),
  });
}

// 홈 경로. 코어가 spec 디렉터리를 홈 축약 표기(`~/.atelier/…`)로 내려 주므로, 본문 이미지가
// 파일을 읽으려면 이것으로 펴야 한다. 앱이 도는 동안 바뀌지 않아 staleTime이 무한이고,
// 캐시가 중복 호출을 막는다 — 작업을 옮길 때마다 뷰어가 리마운트되기 때문에 그 몫이 크다.
export function useHomeDir() {
  return useQuery({ queryKey: ["home-dir"], queryFn: homeDir, staleTime: Infinity });
}
