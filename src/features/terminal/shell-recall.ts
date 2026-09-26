import type { ShellSignal } from "@/components/shell/shell-signal";
import { isCalling } from "./shell-attention";
import type { Shell } from "./shell-registry";

/**
 * **방금 부른 셸로**(프로세스 결정 16 · 프로세스 스펙 S59 · P3 ⌘J · 티켓 23) — 무엇을 기억하고 어디로 가는지를 정하는 순수 함수들.
 *
 * 가는 곳은 **가장 최근에 부르는 상태(기다림 · 확인할 것)에 들어선 셸**이다. 결정 16은 「방금 알린 셸로」라 적었는데 「알린」을
 * 「부른」으로 읽는다: OS 알림을 꺼 두었거나, 그 셸을 보고 있어서 · 같은 work의 창에 접혀서 안 울렸어도 그 셸은 사람을 불렀다.
 * 들어선 순간을 가르는 것은 알림 판정이 이미 한다(`shell-notify.ts`의 `entersCalling` — 회차가 `entered`로 낸다). 여기는 그
 * 순서를 받아 **기억할 키 하나**를 고르고(`nextRecall`), 누른 순간 그 키로 **갈 셸**을 찾는다(`recallTarget`).
 *
 * **셸 키로 기억한다 — 레지스트리 번호가 아니다.** 알림 클릭(판 03 선행 시험이 「안 됨」으로 닫았다)이 되는 날 알림이 싣는 것도
 * 셸 키이고, 두 길이 같은 판정을 지나야 「그 셸은 닫혔어요」가 한 자리에서 선다. 키에는 세대가 들어 있어 다른 실행의 키가 이번
 * 실행의 같은 번호 셸을 가리키지 않는다(S34).
 *
 * 이 모듈은 시간을 모른다 — 차례는 받은 회차와 사실이 도착한 값(`since`)의 크기로만 가른다. 셸 상태의 칸도 직접 안 읽는다:
 * 들어선 셸의 화면값과 시각은 알림 판정의 재료(`notifyShells`)가 이미 뽑아 준 것이다.
 */

/**
 * 부르는 상태에 들어선 셸 하나 — 알림 판정의 재료 한 줄(`NotifyShell`)이 그대로 이 모양이다. `kind`는 화면값이고, `since`는
 * 그 사실이 도착한 값이다. `key`는 그 셸의 셸 키이고 spawn 응답 전이면 `null`이다.
 */
export interface CallEntry {
  key: string | null;
  kind: ShellSignal | null;
  since: number;
}

/**
 * 이 회차에 들어선 셸들을 받아 **다음 기억**을 낸다. 들어선 셸이 없으면 기억 그대로다.
 *
 * - **회차가 곧 차례다.** 이 회차에 들어선 셸이 있으면 앞 회차의 기억보다 늦다 — 앞 셸이 든 값이 더 커도 그렇다(훅 파일의
 *   값은 처리기가 시작한 때라, 늦게 닿은 사건이 더 작은 값을 들 수 있다). 사람이 부름을 겪는 것은 닿은 순간이다.
 * - **한 회차 안에서는 값이 큰 쪽이다.** 감시의 디바운스 한 번에 셸 여럿의 파일이 함께 닿는다. 받은 목록은 띠의 차례(기다림
 *   먼저, 오래된 것 위)라 끝을 고르면 늦게 부른 확인할 것이 먼저 부른 기다림에 밀린다. 값이 같으면 받은 차례의 앞이다.
 * - **도는 중으로 들어선 셸은 안 된다.** 부르는 상태(`isCalling`)만 센다 — 알림 판정이 이미 거르지만 이 규칙의 뜻이라 여기서도
 *   딛는다.
 * - **키가 없는 셸은 기억하지 못한다.** spawn 응답보다 먼저 부른 셸(첫 출력의 OSC)이 그렇다 — 그 한 번을 놓칠 뿐 다른 셸을
 *   가리키지는 않는다.
 */
export function nextRecall(prev: string | null, entered: ReadonlyArray<CallEntry>): string | null {
  let latest: CallEntry | null = null;
  for (const entry of entered) {
    if (entry.key === null || !isCalling(entry.kind)) continue;
    if (latest === null || entry.since > latest.since) latest = entry;
  }
  return latest?.key ?? prev;
}

/**
 * 누른 순간 갈 곳. `null`이면 **아무것도 안 한다** — 부른 셸이 없다.
 *
 * **닫힌 셸은 갈 셸에서 빠진다 — 먼저 부른 다른 셸로 대신 가지 않는다**(fail-closed, 프로세스 결정 16). 사람은 방금 부른 그
 * 셸을 보러 누른 것이라, 엉뚱한 셸로 옮기는 것보다 「그 셸은 닫혔어요」가 참말이다. 옛 세대의 키도 같다 — 키 전체로 찾으므로
 * 이번 실행의 같은 번호 셸로 가지 않는다. 끝났지만 목록에 남은 칸(이유가 있는 끝 — 결정 48)은 닫힌 것이 아니다: 왜 끝났는지
 * 읽으러 간다.
 */
export type RecallTarget = { kind: "go"; shell: Shell } | { kind: "closed" } | null;

export function recallTarget(key: string | null, shells: ReadonlyArray<Shell>): RecallTarget {
  if (key === null) return null;
  const shell = shells.find((one) => one.shellKey === key);
  return shell ? { kind: "go", shell } : { kind: "closed" };
}

/** 기억한 셸이 닫혔을 때의 말(프로세스 결정 16). 동작 버튼이 없는 짧은 토스트로 선다. */
export const CLOSED_SHELL_NOTICE = "그 셸은 닫혔어요";

/**
 * 그 토스트의 id. 한 번 눌러 두 번 도는 날(메뉴와 웹뷰가 같은 키를 함께 받는 날 — `menu-hotkey.ts`의 남는 위험)에도 토스트가
 * 하나로 선다 — 같은 id의 둘째는 그 자리를 고친다.
 */
export const CLOSED_SHELL_TOAST_ID = "recall:closed";

/**
 * ⌘J인가(프로세스 스펙 P3). 메뉴가 쏜 합성 keydown(`menu-hotkey.ts`)과 직접 누른 키가 같은 판정을 지난다.
 *
 * **`code`로 본다** — 한글 입력기가 켜져 있으면 `key`가 자모로 온다(`searchHotkey`와 같은 까닭). 수식키가 하나라도 더 붙으면
 * 아니다. 셸 안에서 눌러도 셸이 먹지 않는다: xterm은 ⌘가 붙은 글자 키를 셸로 안 보내고 막지도 않아 창까지 올라온다
 * (`shell-input.ts`의 `keyRoute` — ⌘B와 같은 갈래).
 */
export function recallHotkey(event: {
  type: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (event.type !== "keydown") return false;
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return event.code === "KeyJ";
}
