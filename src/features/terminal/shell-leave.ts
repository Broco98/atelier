import { isAtOrUnder } from "@/lib/path-prefix";
import { modeOf, routesOf, slugOf } from "@/mode";
import { ownerOf, shellsOf } from "./shell-registry";
import type { ShellOwner, ShellsState } from "./shell-registry";

/**
 * 떠남(프로세스 스펙 S17)과 그때 회수할 셸(프로세스 결정 7). 순수 함수 둘이다.
 *
 * **떠남 = 그 셸의 owner 화면(work · Room · Terminal)에서 다른 owner의 화면이나 owner 없는 화면으로
 * 옮기는 것이다.** 재는 자리는 앱 루트 한 곳 — 라우터의 현재 owner가 바뀌는 순간이다(`ShellReclaim`).
 * 터미널 패인이 내려가는 것에 걸지 않는다: 같은 work 안에서 spec 탭으로 바꿀 때도 패인이 내려가는데,
 * 그것은 떠남이 아니다. 탭은 주소의 search에 있어 owner가 그대로다.
 *
 * 이 모듈은 시간을 모른다. 「입력이 있었나」는 칸에 앉은 값(`Shell.firstInput`)만 본다.
 */

/**
 * 이 주소가 선 화면의 셸 owner. **셸을 띄우는 화면이 아니면 `null`이다** — 목록(`/works`), 아카이브,
 * 프로젝트, 설정이 그렇다.
 *
 * 셸을 띄우는 화면은 셋이다: 그 세계의 work(Room) 하나와 최상위 터미널. 주소를 읽는 규칙은 사이드바
 * 강조와 같은 것을 딛는다(`modeOf` · `slugOf`) — 여기서 따로 적으면 인코딩된 slug(한글)를 한쪽만 푸는
 * 날 떠남이 화면과 다른 owner를 본다. owner 키는 `ownerOf` 하나가 짓는다.
 */
export function screenOwner(pathname: string): ShellOwner | null {
  const mode = modeOf(pathname);
  if (isAtOrUnder(pathname, routesOf(mode).terminal)) return ownerOf(mode);
  const slug = slugOf(pathname);
  return slug === null ? null : ownerOf(mode, slug);
}

/**
 * `from`을 떠나 `to`로 갈 때 닫을 셸의 id. **자동으로 떴고 사람 입력이 없는 `from`의 셸**이다.
 *
 * - 같은 owner에 머물면 떠남이 아니다 — spec 탭 전환이 그렇다.
 * - owner 없는 화면에서 오면 떠난 셸이 없다.
 * - `+` · ⌘T로 연 셸과 한 번이라도 입력을 받은 셸은 안 나온다. 한 번이라도 쓴 셸은 건드리지 않는다.
 * - **도는 셸만이다.** 못 뜬 칸 · 이유가 있어 끝난 칸은 이유를 적고 남는 칸이라(결정 22 · 23) 닫을
 *   프로세스가 없고, 회수하면 읽어야 할 이유가 함께 사라진다.
 *
 * 묻지 않고 닫는다. 입력이 없으면 자손은 모두 셸 도우미라 셸 닫기가 물을 것이 없다 — 프로세스 스펙 P1의
 * 기본값에 기대는 문장이다. P1이 바뀌면 다시 본다.
 */
export function reclaimOnLeave(
  state: ShellsState,
  from: ShellOwner | null,
  to: ShellOwner | null,
): number[] {
  if (from === null || from === to) return [];
  return shellsOf(state, from)
    .filter((shell) => shell.auto && shell.firstInput === null && shell.status.kind === "running")
    .map((shell) => shell.id);
}
