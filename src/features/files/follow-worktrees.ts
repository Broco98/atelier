import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { attentionOn } from "@/features/terminal/shell-attention";
import { slugOfOwner, type ShellsState } from "@/features/terminal/shell-registry";
import { terminalStore } from "@/features/terminal/terminal-store";
import { invalidateWorktree, refreshAllWorktrees, refreshWorktrees } from "./hooks";

/** 감시자가 워크트리 안의 걸리지 않은 변경마다 쏘는 이름(`watcher.rs`의 워크트리 갈래). */
const WORKTREE_CHANGED = "worktree:changed";

/** 그 이벤트의 실음 — 코어의 `WorktreeChange`와 필드 이름이 한 글자도 다르지 않아야 한다. */
interface WorktreeChange {
  slug: string;
  project: string;
}

/**
 * **에이전트가 고치면 트리와 탭이 따라온다**(git-integration 티켓 10 · 결정 34). 워크트리 데이터를 다시 읽게 하는 신호를 앱
 * 루트(`AppShell`)에서 한 번 건다 — 셸은 어느 화면에서든 서 있고, 신호를 쓰는 자리(files 칸 · 파일 탭)마다 들으면 이벤트
 * 한 번에 그 수만큼 다시 읽는다(`works:changed`가 겪은 일). 무엇을 지우는지는 무효화 문(`./hooks`)이 들고, 이 자리는 배선뿐이다.
 *
 * 여기서 거는 신호는 셋이다. 모두 **낡았다고 표시할 뿐이고 다시 읽는 것은 보이는 쿼리뿐이다**(S9) — 숨은 것은 보이는 순간
 * 읽힌다.
 * - `worktree:changed { slug, project }` — 감시가 본 걸리지 않은 변경. 그 워크트리의 트리와 열린 파일 내용(걸린 폴더의 한 겹은
 *   빼고 — 결정 37).
 * - 창 `focus`(window 이벤트) — 모든 워크트리, 걸린 폴더의 한 겹까지. 감시가 못 보는 것(커밋 — 워크트리가 아니라 본 저장소의
 *   `.git`에서 일어난다)을 메운다. Tauri `onFocusChanged`는 쓰지 않는다 — L3 픽스처가 모르는 IPC다(`lib/window-focus.ts`
 *   머리말). 분할의 spec 프레임에서 돌아올 때도 오지만, 보이는 것 몇 개를 한 번 더 읽을 뿐이다.
 * - 이 work 셸의 「도는 중」이 끝날 때 — 에이전트가 턴을 마쳤다(결정 9의 「턴 끝」). 그 work의 워크트리 전부.
 *
 * 예비 신호의 나머지 둘은 여기 없다 — 칸을 열면 트리 쿼리가 켜지며 읽고(`staleTime` 0), 새로고침 버튼은 칸 머리에 선다
 * (`FilesRefresh`). 여기 셋과 새로고침 버튼은 같은 무효화 문을 지나 몰려도 합쳐진다(`./hooks`의 `invalidateMerging`).
 */
export function useFollowWorktreeChanges(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    // 이벤트에는 기다릴 사람이 없다 — works 쪽 리스너와 같다.
    const unlisten = listen<WorktreeChange>(WORKTREE_CHANGED, ({ payload }) => {
      void invalidateWorktree(queryClient, payload.slug, payload.project);
    });
    const onFocus = () => void refreshAllWorktrees(queryClient);
    window.addEventListener("focus", onFocus);
    let before = terminalStore.state;
    const turns = terminalStore.subscribe((after) => {
      for (const slug of turnsEnded(before, after)) void refreshWorktrees(queryClient, slug);
      before = after;
    });
    return () => {
      void unlisten.then((fn) => fn());
      window.removeEventListener("focus", onFocus);
      turns.unsubscribe();
    };
  }, [queryClient]);
}

/**
 * 「도는 중」이던 셸이 멎은 work들 — 앞뒤 상태를 견준다. 도는 중에서 다른 값(확인할 것 · 기다림 · 없음)으로 바뀌었거나, 셸이
 * 끝나 사라졌으면 멎은 것이다. 최상위 터미널의 셸은 워크트리가 없어 세지 않는다.
 *
 * 상태는 `attentionOn`으로 읽는다 — 죽은 칸을 가리는 문이다(`shell-attention.ts`). 셸이 도는 중에 죽으면 그 문이 「없음」을
 * 돌려주므로 그것도 멎은 것이다.
 */
function turnsEnded(before: ShellsState, after: ShellsState): Set<string> {
  const ended = new Set<string>();
  if (before === after) return ended;
  for (const shell of before.shells) {
    if (attentionOn(shell)?.kind !== "working") continue;
    const now = after.shells.find((one) => one.id === shell.id);
    if (now && attentionOn(now)?.kind === "working") continue;
    const slug = slugOfOwner(shell.owner);
    if (slug !== null) ended.add(slug);
  }
  return ended;
}
